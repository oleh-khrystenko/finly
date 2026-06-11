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
import { ReconciliationService } from '../businesses/reconciliation.service';
import { DEFERRED_START_FIRST_CHARGE_GRACE_MS } from '../../common/billing/deferred-start';

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
        private readonly userModel: Model<UserDocument>,

        private readonly reconciliation: ReconciliationService
    ) {}

    @Cron(CronExpression.EVERY_DAY_AT_4AM)
    async runDailyCleanup(): Promise<void> {
        await this.step('retryFailedRemovals', () =>
            this.retryFailedRemovals()
        );
        await this.step('expireCanceledSubscriptions', () =>
            this.expireCanceledSubscriptions()
        );
        await this.step('expirePastDueSubscriptions', () =>
            this.expirePastDueSubscriptions()
        );
        await this.step('expireAbandonedRebinds', () =>
            this.expireAbandonedRebinds()
        );
        await this.step('expireOneOffAccess', () => this.expireOneOffAccess());
        // Останнім: добиває reconcile-и, відкладені lock-контенцією/збоями —
        // і давні (минулі прогони), і щойно відкладені кроками вище.
        await this.step('retryPendingReconciles', () =>
            this.retryPendingReconciles()
        );
    }

    /**
     * Ізолює крок добового ланцюга: внутрішні catch-і кроків покривають лише
     * per-item операції, а top-level find/updateMany — ні. Без ізоляції один
     * transient-збій Mongo у ранньому кроці зривав би весь прогін — зокрема
     * `expireOneOffAccess` (єдиний тригер спливу one-off, вебхука немає) і
     * `retryPendingReconciles` (durable-retry реконсиляцій) — до наступної доби.
     */
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

    /**
     * Реконсиляція бізнесів кожного зачепленого користувача — best-effort
     * (per-user, щоб збій одного не зривав решту батча). Через
     * `reconcileUnderLock` бере той самий per-user білінг-лок, що й
     * вебхуки/мутації: інакше cron-реконсиляція конкурувала б за `accessBlockedAt`
     * з grant-вебхуком того ж користувача (lost-update). Метод сам ловить
     * лок-контенцію і reconcile-помилки, тож тут без додаткового try/catch;
     * відкладені/неповні прогони лишаються стемпнутими `reconcileRequiredAt`
     * (ставиться у `$set` expire-флоу ДО реконсиляції) і доганяються
     * `retryPendingReconciles`.
     */
    private async reconcileUsers(userIds: string[]): Promise<void> {
        for (const userId of userIds) {
            await this.reconciliation.reconcileUnderLock(userId);
        }
    }

    /**
     * Знімає доступ у користувачів, що підпадають під `filter`, і реконсилює їх
     * бізнеси під новий (нижчий) рівень. find→updateMany(той самий filter)
     * зберігає атомарність флипу (реактивований між кроками юзер не матчиться),
     * а reconcile читає свіжий per-user стан, тож ідемпотентний навіть на
     * розбіжності зібраних id зі справді оновленими.
     *
     * Разом з флипом стемпиться `reconcileRequiredAt`: флип знищує сам
     * cron-маркер (наступний прогін цього користувача вже не знайде), тож без
     * durable-стемпа reconcile, відкладений lock-контенцією або урваний крахом,
     * не мав би жодного наступного тригера. Успішний повний reconcile знімає
     * стемп сам.
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
     * Окремий частий cron: crash-orphan pending-події не підтверджуються accept-ом
     * (див. `PaymentsService.routeTransaction`), тож recovery залежить від того,
     * чи встигне sweep прибрати orphan у вікно ретраїв WayForPay. Добовий cron для
     * цього надто рідкий — sweep-имо кожні 10 хв.
     */
    @Cron(CronExpression.EVERY_10_MINUTES)
    async runStalePendingSweep(): Promise<void> {
        await this.step('sweepStalePendingEvents', () =>
            this.sweepStalePendingEvents()
        );
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
        await this.expireAndReconcile(
            {
                'billing.hasActiveSubscription': true,
                'billing.subscriptionStatus': SUBSCRIPTION_STATUS.PAST_DUE,
                'billing.currentPeriodEnd': { $lt: new Date() },
            },
            {
                'billing.hasActiveSubscription': false,
                'billing.subscriptionStatus': SUBSCRIPTION_STATUS.UNPAID,
                'billing.rebindPendingAt': null,
            },
            'past-due subscriptions'
        );
    }

    /**
     * `updateCard` знімає стару рекуренту і чекає привʼязки нової картки,
     * ставлячи `rebindPendingAt`. Якщо користувач кинув checkout, новий рекурент
     * так і не підтверджено, а період минув — знімаємо доступ самі (інакше
     * `hasActiveSubscription` лишився б true без жодного списання). Успішна
     * привʼязка чистить прапорець, тож сюди потрапляють лише кинуті re-bind-и.
     */
    private async expireAbandonedRebinds(): Promise<void> {
        await this.expireAndReconcile(
            {
                'billing.hasActiveSubscription': true,
                'billing.rebindPendingAt': { $ne: null },
                'billing.currentPeriodEnd': { $lt: new Date() },
            },
            {
                'billing.hasActiveSubscription': false,
                'billing.subscriptionStatus': SUBSCRIPTION_STATUS.UNPAID,
                'billing.rebindPendingAt': null,
            },
            'abandoned card re-binds'
        );
    }

    /**
     * Sprint 19 — сплив one-off доступу. Провайдерського вебхука на закінчення
     * one-off немає (це не рекурент), тож ловить cron. Рівень доступу гасне
     * ліниво на read (`deriveAccessLevel` звіряє дату), але реконсиляція
     * (блокування зайвих бізнесів) — активна дія, тож потрібен цей sweep.
     *
     * `$nor`-гілка пропускає користувачів у вікні deferred-старту підписки
     * (TRIALING + перше списання очікується щойно/найближчими днями): для них
     * reconcile на рівні none був би хибним і руйнівним — див.
     * `DEFERRED_START_FIRST_CHARGE_GRACE_MS`.
     *
     * Маркерні поля чистяться РАЗОМ зі стемпом `reconcileRequiredAt` в одному
     * updateMany ДО реконсиляції: рівень reconcile рахує лінивo за датою (вона
     * вже в минулому), а стемп гарантує retry, якщо reconcile відкладено
     * lock-контенцією або процес упав між clear-ом і reconcile-ом. Свіжа
     * покупка між find і updateMany не зачіпається — її `oneOffAccessUntil` у
     * майбутньому і під `$lt`-фільтр не підпадає.
     */
    private async expireOneOffAccess(): Promise<void> {
        const now = new Date();
        const filter = {
            'billing.oneOffLevel': { $ne: null },
            'billing.oneOffAccessUntil': { $lt: now },
            $nor: [
                {
                    'billing.hasActiveSubscription': true,
                    'billing.subscriptionStatus': SUBSCRIPTION_STATUS.TRIALING,
                    'billing.currentPeriodEnd': {
                        $gte: new Date(
                            now.getTime() - DEFERRED_START_FIRST_CHARGE_GRACE_MS
                        ),
                    },
                },
            ],
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
     * Sprint 19 — добиває реконсиляції, що не завершились у своєму тригері:
     * відкладені lock-контенцією, урвані крахом процесу або неповні через
     * батч-ліміт slug-rent. Джерело — durable-стемп `reconcileRequiredAt`
     * (ставлять expire-флоу вище і сам `ReconciliationService.reconcile` при
     * неповному прогоні; знімає повний reconcile). Колекція users мала, тож
     * скан без індексу прийнятний.
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
