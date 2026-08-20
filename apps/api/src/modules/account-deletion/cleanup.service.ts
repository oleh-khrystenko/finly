import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';

import { MAGIC_LINK_LIMITS } from '../../config/auth.config';
import { ACCOUNT_DELETION_GRACE_DAYS } from '../../config/cleanup.config';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { AccountDeletionService } from './account-deletion.service';

const DELIVERY_WINDOW_START = 8; // 8:00 AM local time
const DELIVERY_WINDOW_END = 20; // 8:00 PM local time

@Injectable()
export class CleanupService {
    private readonly logger = new Logger(CleanupService.name);

    constructor(
        @InjectModel(User.name) private userModel: Model<UserDocument>,
        private readonly authService: AuthService,
        private readonly emailService: EmailService,
        private readonly accountDeletion: AccountDeletionService
    ) {}

    /**
     * Кожен крок ізольований, як у `BillingClockService`: збій одного не має
     * права зняти решту. Інакше тимчасова недоступність бази на першому кроці
     * (зняття протермінованих позначок) скасувала б у цьому проході і
     * нагадування, і остаточне видалення — а причини у логах сервісу не було б
     * узагалі, бо помилка полетіла б повз нього у планувальник.
     */
    @Cron(CronExpression.EVERY_6_HOURS)
    async handleExpiredAccounts(): Promise<void> {
        await this.step('clearExpiredDeletionRequests', () =>
            this.clearExpiredDeletionRequests()
        );
        await this.step('resyncDeactivationEffects', () =>
            this.resyncDeactivationEffects()
        );
        await this.step('resyncRestoredAccounts', () =>
            this.resyncRestoredAccounts()
        );
        await this.step('sendDeletionReminders', () =>
            this.sendDeletionReminders()
        );
        await this.step('hardDeleteExpiredAccounts', () =>
            this.hardDeleteExpiredAccounts()
        );
    }

    private async step(label: string, fn: () => Promise<void>): Promise<void> {
        try {
            await fn();
        } catch (error) {
            this.logger.error(
                `Account cleanup step ${label} failed, continuing`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    /**
     * Sprint 32 — позначка «лист надіслано» не переживає термін дії посилання.
     * Вона лише технічний слід: інтерфейс показує «посилання надіслано» і тримає
     * паузу перед повторним надсиланням. Раніше її не знімало ніщо, окрім самої
     * деактивації чи відновлення, тож у людини, яка передумала і листа не
     * відкрила, вона висіла в базі назавжди — при живому посиланні на п'ятнадцять
     * хвилин.
     */
    private async clearExpiredDeletionRequests(): Promise<void> {
        const cutoff = new Date(Date.now() - MAGIC_LINK_LIMITS.ttlMin * 60_000);
        const result = await this.userModel
            .updateMany(
                {
                    deletedAt: null,
                    accountDeletionRequestedAt: { $ne: null, $lte: cutoff },
                },
                { $set: { accountDeletionRequestedAt: null } }
            )
            .exec();

        if (result.modifiedCount > 0) {
            this.logger.log(
                `Cleared ${result.modifiedCount} expired deletion request stamp(s)`
            );
        }
    }

    /**
     * Sprint 32 — добиває ефекти підтвердження на вже деактивованих акаунтах.
     * Деактивація і гасіння публічності це два записи у різні колекції, тож крах
     * між ними лишив би сторінки й списання живими у людини, яка вже пішла.
     * Ідемпотентні фільтри роблять прохід дешевим: у штатному випадку він не
     * змінює нічого.
     *
     * Список деактивованих читається заздалегідь, тож людина може відновити
     * акаунт уже після читання. Гонку закриває сам `applyDeactivationEffects`:
     * він звіряє деактивацію після запису і відкочує позначки, якщо відновлення
     * вклинилось. Тут це знання не дублюється.
     */
    private async resyncDeactivationEffects(): Promise<void> {
        const deactivated = await this.userModel
            .find({ deletedAt: { $ne: null } })
            .select('_id')
            .lean()
            .exec();

        for (const user of deactivated) {
            await this.accountDeletion.applyDeactivationEffectsBestEffort(
                user._id.toString()
            );
        }
    }

    /**
     * Sprint 32 — дзеркальний прохід: знімає позначки, що пережили відновлення
     * акаунта. Крах посеред `revertDeactivationEffects` лишив би активну людину
     * з мертвими публічними сторінками і вічною паузою списань, а повторним
     * натисканням «Відновити» це не лікується — акаунт уже активний, і
     * `restoreAccount` відповідає «Account is not deleted».
     *
     * У штатному випадку кандидатів немає взагалі, тож прохід нічого не читає
     * понад два `distinct` по partial-індексах.
     */
    private async resyncRestoredAccounts(): Promise<void> {
        const userIds =
            await this.accountDeletion.findUsersWithStaleDeactivationEffects();

        for (const userId of userIds) {
            try {
                await this.accountDeletion.revertDeactivationEffects(userId);
                this.logger.warn(
                    `Cleared deactivation effects that survived restore for ${userId}`
                );
            } catch (error) {
                this.logger.error(
                    `Failed to clear stale deactivation effects for ${userId}: ${(error as Error).message}`
                );
            }
        }
    }

    private async sendDeletionReminders(): Promise<void> {
        const graceDays = ACCOUNT_DELETION_GRACE_DAYS;

        if (graceDays < 2) return;

        const reminderCutoff = new Date(
            Date.now() - (graceDays - 1) * 86_400_000
        );
        const hardDeleteCutoff = new Date(Date.now() - graceDays * 86_400_000);

        const usersToRemind = await this.userModel
            .find({
                deletedAt: { $lte: reminderCutoff, $gt: hardDeleteCutoff },
                deletionReminderSentAt: null,
            })
            .select('_id email deletedAt timezone')
            .lean()
            .exec();

        if (usersToRemind.length === 0) return;

        let sent = 0;
        let deferred = 0;

        for (const user of usersToRemind) {
            if (!this.isInDeliveryWindow(user.timezone)) {
                deferred++;
                continue;
            }

            const userId = user._id.toString();
            try {
                const deletionDate = new Date(
                    user.deletedAt!.getTime() + graceDays * 86_400_000
                );

                await this.emailService.sendDeletionReminder({
                    email: user.email,
                    deletionDate,
                });

                await this.userModel.findByIdAndUpdate(userId, {
                    deletionReminderSentAt: new Date(),
                });

                sent++;
            } catch (error) {
                this.logger.error(
                    `Failed to send deletion reminder to ${userId}: ${(error as Error).message}`
                );
            }
        }

        this.logger.log(
            `Deletion reminders: ${sent} sent, ${deferred} deferred (outside delivery window)`
        );
    }

    private async hardDeleteExpiredAccounts(): Promise<void> {
        const cutoff = new Date(
            Date.now() - ACCOUNT_DELETION_GRACE_DAYS * 86_400_000
        );

        const expiredUsers = await this.userModel
            .find({ deletedAt: { $lte: cutoff } })
            .select('_id email')
            .lean()
            .exec();

        if (expiredUsers.length === 0) {
            this.logger.log('No expired accounts to delete');
            return;
        }

        let deleted = 0;
        let deferred = 0;
        let restored = 0;

        for (const user of expiredUsers) {
            const userId = user._id.toString();
            try {
                if (!(await this.claimForPurge(userId, cutoff))) {
                    restored++;
                    continue;
                }
                // Sprint 32 — прибирання всього, що лишається після людини:
                // отримувачі з піддеревом, платіжні хвости, бронь імені,
                // платники. Людина видаляється останньою: якщо прохід упаде
                // посередині, наступний знайде її на місці і доробить залишок.
                const purged = await this.accountDeletion.purgeUser(userId);
                if (!purged) {
                    deferred++;
                    continue;
                }
                await this.authService.revokeAllUserTokens(userId);
                await this.userModel.findByIdAndDelete(userId).exec();
                deleted++;
            } catch (error) {
                this.logger.error(
                    `Failed to hard-delete user ${userId}: ${(error as Error).message}`
                );
            }
        }

        this.logger.log(
            `Hard-deleted ${deleted}/${expiredUsers.length} expired account(s)` +
                (deferred > 0
                    ? `, ${deferred} deferred (reconcile incomplete)`
                    : '') +
                (restored > 0 ? `, ${restored} skipped (restored)` : '')
        );
    }

    /**
     * Sprint 32 — замок між прибиранням і відновленням акаунта. Список
     * протермінованих читається раз, а обхід довгий (на кожного отримувача
     * окрема транзакція), тож людина цілком може натиснути «Відновити» вже
     * після читання — саме в той день, коли їй напередодні прийшов лист про
     * видалення. Без замка її дані знеслись би все одно, і вона повернулась би
     * у живий, але порожній кабінет.
     *
     * Умова стоїть усередині однієї операції бази, а не окремою перевіркою
     * перед нею: перевірка лише звузила б вікно, а не закрила його. Виграє той,
     * хто перший — або `restore` встиг зняти `deletedAt` (тоді умова не
     * зійдеться і прибирання пройде повз), або ми встигли поставити позначку
     * (тоді `restore` відповість, що повертати вже нема чого).
     *
     * Повторний прохід за вже позначеним акаунтом (попередній упав або відклався
     * через незавершений перерахунок) умову проходить: важлива саме досі чинна
     * деактивація, а не свіжість позначки.
     */
    private async claimForPurge(
        userId: string,
        cutoff: Date
    ): Promise<boolean> {
        const claimed = await this.userModel
            .findOneAndUpdate(
                { _id: userId, deletedAt: { $lte: cutoff } },
                { $set: { accountPurgeStartedAt: new Date() } },
                { new: true }
            )
            .select('_id')
            .lean()
            .exec();
        if (!claimed) {
            this.logger.log(
                `Skipping hard-delete for ${userId}: account no longer deactivated`
            );
        }
        return claimed !== null;
    }

    private isInDeliveryWindow(timezone: string | null): boolean {
        if (!timezone) return true;

        try {
            const localHour = new Date().toLocaleString('en-US', {
                hour: 'numeric',
                hour12: false,
                timeZone: timezone,
            });

            const hour = parseInt(localHour, 10);
            return hour >= DELIVERY_WINDOW_START && hour < DELIVERY_WINDOW_END;
        } catch {
            return true;
        }
    }
}
