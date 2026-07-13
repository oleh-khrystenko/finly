import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { SUBSCRIPTION_STATUS } from '@finly/types';

import { ENV } from '../../config/env';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import {
    BillingProfile,
    BillingProfileDocument,
} from '../payments/schemas/billing-profile.schema';
import { User, UserDocument } from './schemas/user.schema';

const DELIVERY_WINDOW_START = 8; // 8:00 AM local time
const DELIVERY_WINDOW_END = 20; // 8:00 PM local time

@Injectable()
export class CleanupService {
    private readonly logger = new Logger(CleanupService.name);

    constructor(
        @InjectModel(User.name) private userModel: Model<UserDocument>,
        @InjectModel(BillingProfile.name)
        private readonly profileModel: Model<BillingProfileDocument>,
        private readonly authService: AuthService,
        private readonly emailService: EmailService
    ) {}

    @Cron(CronExpression.EVERY_6_HOURS)
    async handleExpiredAccounts(): Promise<void> {
        await this.sendDeletionReminders();
        await this.hardDeleteExpiredAccounts();
    }

    private async sendDeletionReminders(): Promise<void> {
        const graceDays = ENV.ACCOUNT_DELETION_GRACE_DAYS;

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
            Date.now() - ENV.ACCOUNT_DELETION_GRACE_DAYS * 86_400_000
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

        for (const user of expiredUsers) {
            const userId = user._id.toString();
            try {
                // Спершу білінг: clock читає лише BillingProfile і без ретайру
                // списував би картку неіснуючого акаунта далі. Порядок
                // crash-safe: якщо впали після ретайру, наступний прохід
                // ре-ретайрить (no-op) і видалить користувача.
                await this.retireBillingProfile(userId);
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
            `Hard-deleted ${deleted}/${expiredUsers.length} expired account(s)`
        );
    }

    /**
     * Гасить білінг-профіль платника, що видаляється: зупиняє планувальник
     * (nextChargeAt/nextRetryAt → null), зачищає токен і ставить CANCELED.
     * Стемп `reconcileRequiredAt` — durable-тригер: daily-sweep payments-модуля
     * реконсилює прикріплені бізнеси (бренд-фічі гаснуть) навіть якщо цей
     * прохід упаде одразу після update. Idempotent через фільтр статусу.
     */
    private async retireBillingProfile(userId: string): Promise<void> {
        await this.profileModel.updateOne(
            {
                userId: new Types.ObjectId(userId),
                status: { $ne: SUBSCRIPTION_STATUS.CANCELED },
            },
            {
                $set: {
                    status: SUBSCRIPTION_STATUS.CANCELED,
                    nextChargeAt: null,
                    nextRetryAt: null,
                    cardToken: null,
                },
                // $max — маркер реконсиляції монотонний: cron без user-лока не
                // сміє перекрити новіший конкурентний стемп старішою датою,
                // інакше clear того тригера ($lte його стемпа) стер би durable-
                // слід (див. PaymentsCleanupService.expireCanceledProfiles).
                $max: { reconcileRequiredAt: new Date() },
            }
        );
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
