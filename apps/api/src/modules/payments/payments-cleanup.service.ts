import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { SUBSCRIPTION_STATUS } from '@finly/types';

import {
    ProcessedWebhookEvent,
    ProcessedWebhookEventDocument,
} from './schemas/processed-webhook-event.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ReconciliationService } from '../businesses/reconciliation.service';

/**
 * `pending` webhook-подія, старша за цей поріг, — crash-orphan (нормальна
 * обробка — десятки секунд щонайбільше). Видаляємо, щоб наступна доставка
 * monobank створила свіжий запис і застосувала ефект. Поки orphan живий,
 * `PaymentsService.routeTransaction` НЕ підтверджує його, тож monobank
 * передоставляє; поріг тримаємо коротким, щоб recovery встиг у вікно повторів.
 */
const STALE_PENDING_EVENT_MS = 15 * 60 * 1000;

@Injectable()
export class PaymentsCleanupService {
    private readonly logger = new Logger(PaymentsCleanupService.name);

    constructor(
        @InjectModel(ProcessedWebhookEvent.name)
        private readonly webhookEventModel: Model<ProcessedWebhookEventDocument>,

        @InjectModel(User.name)
        private readonly userModel: Model<UserDocument>,

        private readonly reconciliation: ReconciliationService
    ) {}

    @Cron(CronExpression.EVERY_DAY_AT_4AM)
    async runDailyCleanup(): Promise<void> {
        await this.step('expireCanceledSubscriptions', () =>
            this.expireCanceledSubscriptions()
        );
        await this.step('expireOneOffAccess', () => this.expireOneOffAccess());
        // Останнім: добиває reconcile-и, відкладені lock-контенцією/збоями.
        await this.step('retryPendingReconciles', () =>
            this.retryPendingReconciles()
        );
    }

    /**
     * Sweep завислих pending-подій частий: crash-orphan не підтверджується (див.
     * `PaymentsService.routeTransaction`), тож recovery залежить від того, чи
     * встигне sweep прибрати orphan у вікно повторів monobank.
     */
    @Cron(CronExpression.EVERY_10_MINUTES)
    async runStalePendingSweep(): Promise<void> {
        await this.step('sweepStalePendingEvents', () =>
            this.sweepStalePendingEvents()
        );
    }

    private async step(label: string, fn: () => Promise<void>): Promise<void> {
        try {
            await fn();
        } catch (error) {
            this.logger.error(
                `Daily cleanup step ${label} failed, continuing with next step`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    private async reconcileUsers(userIds: string[]): Promise<void> {
        for (const userId of userIds) {
            await this.reconciliation.reconcileUnderLock(userId);
        }
    }

    /**
     * Знімає доступ у користувачів під `filter` і реконсилює їх бізнеси під новий
     * (нижчий) рівень. find→updateMany(той самий filter) зберігає атомарність
     * флипу; reconcile читає свіжий стан, тож ідемпотентний.
     */
    private async expireAndReconcile(
        filter: Record<string, unknown>,
        set: Record<string, unknown>,
        label: string
    ): Promise<void> {
        const users = await this.userModel.find(filter, { _id: 1 }).lean();
        if (users.length === 0) return;
        await this.userModel.updateMany(filter, {
            $set: { ...set, 'billing.reconcileRequiredAt': new Date() },
        });
        this.logger.log(`Expired ${users.length} ${label}`);
        await this.reconcileUsers(users.map((u) => u._id.toString()));
    }

    /**
     * Скасована-в-кінці-періоду підписка просто перестає поновлюватись
     * (billing-clock її не чіпає, бо `nextChargeAt` null). Доступ
     * (`hasActiveSubscription`) знімаємо самі, коли межа періоду минула.
     */
    private async expireCanceledSubscriptions(): Promise<void> {
        await this.expireAndReconcile(
            {
                'billing.hasActiveSubscription': true,
                'billing.cancelAtPeriodEnd': true,
                'billing.currentPeriodEnd': { $lt: new Date() },
            },
            {
                'billing.hasActiveSubscription': false,
                'billing.subscriptionStatus': SUBSCRIPTION_STATUS.CANCELED,
            },
            'canceled-at-period-end subscriptions'
        );
    }

    /**
     * Sprint 19 — сплив one-off доступу. Провайдерського вебхука на закінчення
     * one-off немає, тож ловить cron. Рівень гасне ліниво на read, але
     * реконсиляція (блокування зайвих бізнесів) — активна дія, тож потрібен sweep.
     */
    private async expireOneOffAccess(): Promise<void> {
        const now = new Date();
        const filter = {
            'billing.oneOffLevel': { $ne: null },
            'billing.oneOffAccessUntil': { $lt: now },
        };
        const users = await this.userModel.find(filter, { _id: 1 }).lean();
        if (users.length === 0) return;
        await this.userModel.updateMany(filter, {
            $set: {
                'billing.oneOffLevel': null,
                'billing.oneOffAccessUntil': null,
                'billing.oneOffOrderReference': null,
                'billing.reconcileRequiredAt': new Date(),
            },
        });
        this.logger.log(`Expired ${users.length} one-off access grants`);
        await this.reconcileUsers(users.map((u) => u._id.toString()));
    }

    /**
     * Sprint 19 — добиває реконсиляції, що не завершились у своєму тригері
     * (lock-контенція, крах, батч-ліміт slug-rent). Джерело — durable-стемп
     * `reconcileRequiredAt`; знімає повний reconcile. Колекція users мала.
     */
    private async retryPendingReconciles(): Promise<void> {
        const users = await this.userModel
            .find({ 'billing.reconcileRequiredAt': { $ne: null } }, { _id: 1 })
            .lean();
        if (users.length === 0) return;
        this.logger.log(`Retrying ${users.length} pending reconciles`);
        await this.reconcileUsers(users.map((u) => u._id.toString()));
    }

    /**
     * Видаляємо crash-orphan `pending` webhook-події. Видалення дозволяє наступній
     * доставці monobank переобробити подію з нуля; доти `routeTransaction` не
     * підтверджує orphan, тож провайдер продовжує передоставку і ефект не губиться.
     */
    private async sweepStalePendingEvents(): Promise<void> {
        const cutoff = new Date(Date.now() - STALE_PENDING_EVENT_MS);
        const result = await this.webhookEventModel.deleteMany({
            status: 'pending',
            receivedAt: { $lt: cutoff },
        });
        if (result.deletedCount > 0) {
            this.logger.warn(
                `Swept ${result.deletedCount} stale pending webhook events`
            );
        }
    }
}
