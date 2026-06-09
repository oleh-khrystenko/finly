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
 * обробка — десятки секунд щонайбільше: REQUEST_TIMEOUT 20s + TX maxTimeMS 10s,
 * а живий творець утримує per-user лок). Видаляємо, щоб наступна доставка
 * WayForPay створила свіжий запис і застосувала ефект. Поки orphan живий,
 * `PaymentsService.routeTransaction` НЕ підтверджує його accept-ом, тож WayForPay
 * передоставляє; поріг тримаємо коротким, щоб recovery встиг у вікно ретраїв
 * провайдера, а не чекав добового cron.
 */
const STALE_PENDING_EVENT_MS = 15 * 60 * 1000;

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
        await this.expirePastDueSubscriptions();
        await this.expireAbandonedRebinds();
    }

    /**
     * Окремий частий cron: crash-orphan pending-події не підтверджуються accept-ом
     * (див. `PaymentsService.routeTransaction`), тож recovery залежить від того,
     * чи встигне sweep прибрати orphan у вікно ретраїв WayForPay. Добовий cron для
     * цього надто рідкий — sweep-имо кожні 10 хв.
     */
    @Cron(CronExpression.EVERY_10_MINUTES)
    async runStalePendingSweep(): Promise<void> {
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
     * Підписка у `PAST_DUE` (останнє списання відхилено) тримає доступ до межі
     * періоду, поки WayForPay перебирає провайдерські ретраї. Якщо межа минула,
     * а статусу так і не повернули в `ACTIVE` (успішний ретрай надіслав би
     * Approved-вебхук, що сам флипнув би доступ і продовжив період), знімаємо
     * доступ самі. Симетрично `expireCanceledSubscriptions`: WayForPay не шле
     * термінальний вебхук, коли рекурент просто перестає поновлюватись, тож без
     * цього sweep `hasActiveSubscription` лишився б true назавжди без оплати.
     *
     * Рекурент НЕ знімаємо (`REMOVE`): живі ретраї лишаємо WayForPay — пізній
     * успішний ретрай надішле Approved і відновить підписку (`occurredAt` новіший
     * за `lastProviderEventAt`, тож out-of-order guard пропустить його).
     *
     * Чистимо `rebindPendingAt`: re-bind, верифікація якого впала (declined на
     * новому `orderReference` → `PAST_DUE`, прапорець лишається), потрапляє сюди
     * раніше за `expireAbandonedRebinds`. Без скидання прапорець завис би
     * назавжди, а пізніший успішний Approved пішов би у re-bind-гілку і не
     * повернув би `hasActiveSubscription` у true.
     */
    private async expirePastDueSubscriptions(): Promise<void> {
        const result = await this.userModel.updateMany(
            {
                'billing.hasActiveSubscription': true,
                'billing.subscriptionStatus': SUBSCRIPTION_STATUS.PAST_DUE,
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
                `Expired ${result.modifiedCount} past-due subscriptions`
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
     * Видаляємо crash-orphan `pending` webhook-події (слід урваної обробки).
     * Видалення дозволяє наступній доставці WayForPay переобробити подію з нуля;
     * доти `routeTransaction` не підтверджує orphan accept-ом, тож провайдер
     * продовжує передоставку і ефект не губиться.
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
