import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { SUBSCRIPTION_STATUS } from '@finly/types';

import {
    PAYMENT_PROVIDER,
    IPaymentProvider,
} from './interfaces/payment-provider.interface';
import {
    FailedRecurringRemoval,
    FailedRecurringRemovalDocument,
} from './schemas/failed-recurring-removal.schema';
import {
    ProcessedWebhookEvent,
    ProcessedWebhookEventDocument,
} from './schemas/processed-webhook-event.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

/** Stop retrying after this many failed attempts. */
const MAX_ATTEMPTS = 5;

/**
 * `pending` webhook-подія, старша за цей поріг, — crash-orphan (нормальна
 * обробка триває мілісекунди). Видаляємо, щоб наступна доставка WayForPay
 * створила свіжий запис і застосувала ефект; доти дублікати лише пропускаються
 * (див. `PaymentsService.insertWebhookEvent`).
 */
const STALE_PENDING_EVENT_MS = 60 * 60 * 1000;

@Injectable()
export class PaymentsCleanupService {
    private readonly logger = new Logger(PaymentsCleanupService.name);

    constructor(
        @Inject(PAYMENT_PROVIDER)
        private readonly paymentProvider: IPaymentProvider,

        @InjectModel(FailedRecurringRemoval.name)
        private readonly failedRemovalModel: Model<FailedRecurringRemovalDocument>,

        @InjectModel(ProcessedWebhookEvent.name)
        private readonly webhookEventModel: Model<ProcessedWebhookEventDocument>,

        @InjectModel(User.name)
        private readonly userModel: Model<UserDocument>
    ) {}

    @Cron(CronExpression.EVERY_DAY_AT_4AM)
    async runDailyCleanup(): Promise<void> {
        await this.retryFailedRemovals();
        await this.expireCanceledSubscriptions();
        await this.expireAbandonedRebinds();
        await this.sweepStalePendingEvents();
    }

    /**
     * Добиваємо WayForPay `REMOVE` рекуренту, який не зняли синхронно під час
     * скидання білінгу. Без цього залишений рекурент продовжував би списувати.
     */
    private async retryFailedRemovals(): Promise<void> {
        const pending = await this.failedRemovalModel
            .find({ attempts: { $lt: MAX_ATTEMPTS } })
            .lean();
        if (pending.length === 0) return;

        let cleaned = 0;
        for (const item of pending) {
            try {
                await this.paymentProvider.removeSubscription(
                    item.orderReference
                );
                await this.failedRemovalModel.findByIdAndDelete(item._id);
                cleaned++;
            } catch (error) {
                await this.failedRemovalModel.findByIdAndUpdate(item._id, {
                    $inc: { attempts: 1 },
                    $set: { lastAttemptAt: new Date() },
                });
                const attempts = item.attempts + 1;
                const msg = `REMOVE retry for ${item.orderReference} (attempt ${attempts}/${MAX_ATTEMPTS})`;
                if (attempts >= MAX_ATTEMPTS) {
                    this.logger.error(
                        `Giving up: ${msg}`,
                        error instanceof Error ? error.stack : String(error)
                    );
                } else {
                    this.logger.warn(`Failed: ${msg}`);
                }
            }
        }
        this.logger.log(
            `Recurring REMOVE retries: ${cleaned}/${pending.length} cleared`
        );
    }

    /**
     * Скасована-в-кінці-періоду підписка не отримує термінального вебхука від
     * WayForPay (просто перестає поновлюватись на dateEnd). Тому доступ
     * (`hasActiveSubscription`) знімаємо самі, коли межа періоду минула.
     */
    private async expireCanceledSubscriptions(): Promise<void> {
        const result = await this.userModel.updateMany(
            {
                'billing.hasActiveSubscription': true,
                'billing.cancelAtPeriodEnd': true,
                'billing.currentPeriodEnd': { $lt: new Date() },
            },
            {
                $set: {
                    'billing.hasActiveSubscription': false,
                    'billing.subscriptionStatus': SUBSCRIPTION_STATUS.CANCELED,
                },
            }
        );
        if (result.modifiedCount > 0) {
            this.logger.log(
                `Expired ${result.modifiedCount} canceled-at-period-end subscriptions`
            );
        }
    }

    /**
     * `updateCard` знімає стару рекуренту і чекає привʼязки нової картки,
     * ставлячи `rebindPendingAt`. Якщо користувач кинув checkout, новий рекурент
     * так і не підтверджено, а період минув — знімаємо доступ самі (інакше
     * `hasActiveSubscription` лишився б true без жодного списання). Успішна
     * привʼязка чистить прапорець, тож сюди потрапляють лише кинуті re-bind-и.
     */
    private async expireAbandonedRebinds(): Promise<void> {
        const result = await this.userModel.updateMany(
            {
                'billing.hasActiveSubscription': true,
                'billing.rebindPendingAt': { $ne: null },
                'billing.currentPeriodEnd': { $lt: new Date() },
            },
            {
                $set: {
                    'billing.hasActiveSubscription': false,
                    'billing.subscriptionStatus': SUBSCRIPTION_STATUS.UNPAID,
                    'billing.rebindPendingAt': null,
                },
            }
        );
        if (result.modifiedCount > 0) {
            this.logger.log(
                `Expired ${result.modifiedCount} abandoned card re-binds`
            );
        }
    }

    /**
     * Видаляємо crash-orphan `pending` webhook-події: нормальна обробка триває
     * мілісекунди, тож pending старший за поріг — слід урваної обробки. Видалення
     * дозволяє наступній доставці WayForPay переобробити подію з нуля (доти
     * дублікати лише пропускаються, не переобробляються).
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
