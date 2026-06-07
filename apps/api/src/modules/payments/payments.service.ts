import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    Logger,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import Redis from 'ioredis';
import {
    BILLING_CURRENCY,
    EXECUTION_ACTION,
    EXECUTION_TRANSACTION_TYPE,
    PAYMENT_RECORD_STATUS,
    PAYMENT_RECORD_TYPE,
    PAYMENT_TYPE,
    RESPONSE_CODE,
    SUBSCRIPTION_STATUS,
    SUBSCRIPTION_TRIAL_MONTHS,
    WAYFORPAY_TRANSACTION_STATUS,
    findExecutionPack,
    findSubscriptionPlan,
    type BillingInterval,
    type BillingWebhookEvent,
    type CancelSubscription,
    type ChangePlan,
    type CreateCheckoutSession,
    type PaymentRecordType,
} from '@finly/types';
import { ENV } from '../../config/env';
import {
    IPaymentProvider,
    PAYMENT_PROVIDER,
    type SubscriptionChange,
} from './interfaces/payment-provider.interface';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
    ProcessedWebhookEvent,
    ProcessedWebhookEventDocument,
} from './schemas/processed-webhook-event.schema';
import {
    FailedRecurringRemoval,
    FailedRecurringRemovalDocument,
} from './schemas/failed-recurring-removal.schema';
import {
    PaymentRecord,
    PaymentRecordDocument,
    PaymentRecordLean,
} from './schemas/payment-record.schema';
import { UsersService } from '../users/users.service';
import { REDIS_CLIENT } from '../../common/modules/redis.module';
import {
    ORDER_KIND,
    buildPackOrderReference,
    buildSubscriptionOrderReference,
    parseOrderReference,
    type ParsedOrderReference,
} from './order-reference';

const WEBHOOK_MONGO_TIMEOUT_MS = 10_000;
const PROVIDER = 'wayforpay';

// Стеля утримання per-user білінг-локу. Найдовша операція (changePlan upgrade)
// робить послідовно proration-Charge + CHANGE, кожен до REQUEST_TIMEOUT_MS=20s,
// тож 60s покриває з запасом. Lock авто-звільняється по TTL, якщо процес упав
// усередині критичної секції.
const BILLING_LOCK_TTL_MS = 60_000;
const BILLING_LOCK_PREFIX = 'billing_op:';

// Звільнення локу — compare-and-delete: знімаємо лише власний токен, інакше
// операція, що перевищила TTL, видалила б lock, уже захоплений іншим запитом.
const BILLING_LOCK_RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
`;

// Нефінальні статуси транзакції: проміжний колбек, після якого WayForPay
// надішле фінальний статус окремою подією (providerEventId містить статус).
const NON_TERMINAL_TRANSACTION_STATUSES: readonly string[] = [
    WAYFORPAY_TRANSACTION_STATUS.IN_PROCESSING,
    WAYFORPAY_TRANSACTION_STATUS.PENDING,
];

@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);

    constructor(
        @Inject(PAYMENT_PROVIDER)
        private readonly paymentProvider: IPaymentProvider,

        @InjectModel(User.name)
        private readonly userModel: Model<UserDocument>,

        @InjectModel(ProcessedWebhookEvent.name)
        private readonly webhookEventModel: Model<ProcessedWebhookEventDocument>,

        @InjectModel(FailedRecurringRemoval.name)
        private readonly failedRemovalModel: Model<FailedRecurringRemovalDocument>,

        @InjectModel(PaymentRecord.name)
        private readonly paymentRecordModel: Model<PaymentRecordDocument>,

        @Inject(REDIS_CLIENT)
        private readonly redis: Redis,

        @InjectConnection()
        private readonly connection: Connection,

        private readonly usersService: UsersService
    ) {}

    /**
     * Серіалізує білінг-write-операції одного користувача per-user Redis-локом.
     * WayForPay charge/refund/CHANGE неідемпотентні: два паралельні запити (дві
     * вкладки) інакше задвоїли б proration-списання чи refund. Lock зайнятий →
     * `BILLING_OPERATION_IN_PROGRESS`. Звільнення гарантоване (`finally`) +
     * TTL-fallback на випадок краху всередині секції.
     */
    private async withBillingLock<T>(
        userId: string,
        fn: () => Promise<T>
    ): Promise<T> {
        const key = `${BILLING_LOCK_PREFIX}${userId}`;
        const token = randomBytes(16).toString('hex');
        const acquired = await this.redis.set(
            key,
            token,
            'PX',
            BILLING_LOCK_TTL_MS,
            'NX'
        );
        if (acquired !== 'OK') {
            throw new ConflictException({
                code: RESPONSE_CODE.BILLING_OPERATION_IN_PROGRESS,
                message: 'Billing operation already in progress',
            });
        }
        try {
            return await fn();
        } finally {
            try {
                await this.redis.eval(
                    BILLING_LOCK_RELEASE_SCRIPT,
                    1,
                    key,
                    token
                );
            } catch (error) {
                this.logger.error(
                    `Failed to release billing lock for user ${userId} (expires in ≤${BILLING_LOCK_TTL_MS}ms)`,
                    error instanceof Error ? error.stack : String(error)
                );
            }
        }
    }

    // ── Checkout ─────────────────────────────────────────────────────────

    async createCheckoutSession(
        userId: string,
        dto: CreateCheckoutSession
    ): Promise<{ checkoutUrl: string }> {
        return this.withBillingLock(userId, () =>
            this.createCheckoutSessionLocked(userId, dto)
        );
    }

    private async createCheckoutSessionLocked(
        userId: string,
        dto: CreateCheckoutSession
    ): Promise<{ checkoutUrl: string }> {
        const { paymentType, planCode, packCode, returnPath } = dto;

        if (
            paymentType === PAYMENT_TYPE.SUBSCRIPTION &&
            !ENV.PAYMENTS_SUBSCRIPTION_ENABLED
        ) {
            throw this.disabled();
        }
        if (
            paymentType === PAYMENT_TYPE.ONE_OFF &&
            !ENV.PAYMENTS_ONE_OFF_ENABLED
        ) {
            throw this.disabled();
        }

        const user = await this.userModel.findById(userId).lean();
        if (!user) {
            throw new BadRequestException({
                code: RESPONSE_CODE.NOT_FOUND,
                message: 'User not found',
            });
        }

        const serviceUrl = this.serviceUrl();
        const returnUrl = this.returnUrl(returnPath);

        if (paymentType === PAYMENT_TYPE.SUBSCRIPTION) {
            if (user.billing?.hasActiveSubscription) {
                throw new ConflictException({
                    code: RESPONSE_CODE.ALREADY_SUBSCRIBED,
                    message: 'Already subscribed',
                });
            }
            const plan = findSubscriptionPlan(planCode ?? '');
            if (!plan) {
                throw new BadRequestException({
                    code: RESPONSE_CODE.INVALID_PLAN,
                    message: 'Invalid planCode',
                });
            }

            const orderReference = buildSubscriptionOrderReference(userId);
            const trialEnd = addMonths(new Date(), SUBSCRIPTION_TRIAL_MONTHS);

            // Optimistically persist INCOMPLETE billing: access не дається
            // (hasActiveSubscription=false) поки перший колбек WayForPay не
            // підтвердить привʼязку картки. trialEnd зберігаємо як межу періоду.
            await this.userModel.findByIdAndUpdate(userId, {
                $set: {
                    billing: this.freshBilling({
                        orderReference,
                        planCode: plan.code,
                        currency: plan.currency,
                        subscriptionStatus: SUBSCRIPTION_STATUS.INCOMPLETE,
                        currentPeriodEnd: trialEnd,
                    }),
                },
            });

            const result =
                await this.paymentProvider.createSubscriptionCheckout({
                    userId,
                    userEmail: user.email,
                    orderReference,
                    planName: this.planLabel(plan.code),
                    amount: plan.priceAmount,
                    currency: plan.currency,
                    interval: plan.interval,
                    firstChargeDate: trialEnd,
                    serviceUrl,
                    returnUrl,
                });
            return { checkoutUrl: result.checkoutUrl };
        }

        const pack = findExecutionPack(packCode ?? '');
        if (!pack) {
            throw new BadRequestException({
                code: RESPONSE_CODE.INVALID_PLAN,
                message: 'Invalid packCode',
            });
        }
        const orderReference = buildPackOrderReference(userId, pack.code);
        const result = await this.paymentProvider.createOneOffCheckout({
            userId,
            userEmail: user.email,
            orderReference,
            packName: this.packLabel(pack.code),
            amount: pack.priceAmount,
            currency: pack.currency,
            serviceUrl,
            returnUrl,
        });
        return { checkoutUrl: result.checkoutUrl };
    }

    // ── Subscription management ──────────────────────────────────────────

    async cancelSubscription(
        userId: string,
        dto: CancelSubscription
    ): Promise<{ refundedAmount: number | null }> {
        return this.withBillingLock(userId, () =>
            this.cancelSubscriptionLocked(userId, dto)
        );
    }

    private async cancelSubscriptionLocked(
        userId: string,
        dto: CancelSubscription
    ): Promise<{ refundedAmount: number | null }> {
        const { billing } = await this.requireActiveSubscription(userId);
        const orderReference = billing.orderReference!;

        if (!dto.withRefund) {
            // Кінець періоду: не поновлювати після межі, доступ лишається.
            await this.changeRecurringOrThrow(orderReference, {
                endDate: billing.currentPeriodEnd ?? undefined,
            });
            await this.userModel.findByIdAndUpdate(userId, {
                $set: {
                    'billing.cancelAtPeriodEnd': true,
                    'billing.scheduledPlanCode': null,
                    'billing.scheduledChangeDate': null,
                },
            });
            return { refundedAmount: null };
        }

        // З поверненням за невикористаний період.
        const lastCharge = await this.paymentRecordModel
            .findOne({
                userId: new Types.ObjectId(userId),
                type: PAYMENT_RECORD_TYPE.SUBSCRIPTION,
                status: PAYMENT_RECORD_STATUS.APPROVED,
            })
            .sort({ createdAt: -1 })
            .lean();

        const interval = this.planInterval(billing.planCode);
        const refundAmount = lastCharge
            ? Math.round(
                  lastCharge.amount *
                      remainingRatio(billing.currentPeriodEnd, interval)
              )
            : 0;

        if (lastCharge && refundAmount > 0) {
            const result = await this.paymentProvider.refund({
                orderReference,
                amount: refundAmount,
                currency: billing.currency ?? BILLING_CURRENCY,
                comment:
                    'Скасування підписки з поверненням за невикористаний період',
            });
            if (!result.success) {
                throw new BadRequestException({
                    code: RESPONSE_CODE.REFUND_FAILED,
                    message: 'Refund failed',
                });
            }
            await this.paymentRecordModel.updateOne(
                { _id: lastCharge._id },
                {
                    $set: {
                        status: PAYMENT_RECORD_STATUS.REFUNDED,
                        refundAmount,
                    },
                }
            );
        }

        await this.removeRecurringWithRetry(orderReference, 'cancel_refund');

        await this.userModel.findByIdAndUpdate(userId, {
            $set: {
                'billing.subscriptionStatus': SUBSCRIPTION_STATUS.CANCELED,
                'billing.hasActiveSubscription': false,
                'billing.cancelAtPeriodEnd': false,
                'billing.scheduledPlanCode': null,
                'billing.scheduledChangeDate': null,
            },
        });

        return { refundedAmount: refundAmount > 0 ? refundAmount : null };
    }

    async changePlan(
        userId: string,
        dto: ChangePlan
    ): Promise<{ scheduled: boolean }> {
        return this.withBillingLock(userId, () =>
            this.changePlanLocked(userId, dto)
        );
    }

    private async changePlanLocked(
        userId: string,
        dto: ChangePlan
    ): Promise<{ scheduled: boolean }> {
        const { billing } = await this.requireActiveSubscription(userId);
        const orderReference = billing.orderReference!;

        const current = findSubscriptionPlan(billing.planCode ?? '');
        const target = findSubscriptionPlan(dto.planCode);
        if (!target) {
            throw new BadRequestException({
                code: RESPONSE_CODE.INVALID_PLAN,
                message: 'Invalid planCode',
            });
        }
        if (current && current.code === target.code) {
            throw new BadRequestException({
                code: RESPONSE_CODE.SAME_PLAN,
                message: 'Already on this plan',
            });
        }

        const currentPrice = current?.priceAmount ?? 0;
        const isUpgrade = target.priceAmount > currentPrice;

        if (!isUpgrade) {
            // Downgrade — з наступного періоду. CHANGE знижує суму рекурента
            // на наступний цикл; план і executions перемикаються на межі
            // (renewal-webhook застосує scheduled-перехід).
            await this.changeRecurringOrThrow(orderReference, {
                amount: target.priceAmount,
                currency: target.currency,
                interval: target.interval,
            });
            await this.userModel.findByIdAndUpdate(userId, {
                $set: {
                    'billing.scheduledPlanCode': target.code,
                    'billing.scheduledChangeDate': billing.currentPeriodEnd,
                },
            });
            return { scheduled: true };
        }

        // Upgrade — одразу. Спершу тиха proration-доплата за збереженим токеном;
        // ТІЛЬКИ після підтвердженої оплати піднімаємо рекурент і нараховуємо
        // executions. Без токена silent-доплата неможлива.
        if (!billing.recToken) {
            throw new BadRequestException({
                code: RESPONSE_CODE.PRORATION_PAYMENT_FAILED,
                message: 'No saved card token for proration',
            });
        }

        const ratio = remainingRatio(
            billing.currentPeriodEnd,
            this.planInterval(billing.planCode)
        );
        const prorationAmount = Math.round(
            (target.priceAmount - currentPrice) * ratio
        );

        let prorationRef: string | null = null;
        if (prorationAmount > 0) {
            prorationRef = `fin-prorate-${userId}-${Date.now().toString(36)}`;
            const charge = await this.paymentProvider.chargeByToken({
                orderReference: prorationRef,
                recToken: billing.recToken,
                amount: prorationAmount,
                currency: target.currency,
                description: `Доплата за апгрейд плану ${this.planLabel(target.code)}`,
            });
            if (!charge.success) {
                throw new BadRequestException({
                    code: RESPONSE_CODE.PRORATION_PAYMENT_FAILED,
                    message: 'Proration charge declined',
                });
            }
            await this.recordPayment({
                userId,
                orderReference: prorationRef,
                type: PAYMENT_RECORD_TYPE.PRORATION,
                amount: prorationAmount,
                currency: target.currency,
                status: PAYMENT_RECORD_STATUS.APPROVED,
                providerTransactionId: charge.transactionId,
                cardMask: charge.cardMask ?? billing.cardMask,
            });
        }

        // Якщо proration уже списано, а підняти рекурент не вдалось — повертаємо
        // доплату, інакше користувач заплатив за апгрейд, якого не отримав
        // (план/рекурент лишаються старими). Тільки після успішного CHANGE
        // піднімаємо план і нараховуємо executions.
        try {
            await this.changeRecurringOrThrow(orderReference, {
                amount: target.priceAmount,
                currency: target.currency,
                interval: target.interval,
            });
        } catch (error) {
            if (prorationRef && prorationAmount > 0) {
                await this.refundProration(
                    prorationRef,
                    prorationAmount,
                    target.currency
                );
            }
            throw error;
        }

        const executionsDelta = Math.round(
            ((target.executions ?? 0) - (current?.executions ?? 0)) * ratio
        );

        const update: Record<string, unknown> = {
            'billing.planCode': target.code,
            'billing.scheduledPlanCode': null,
            'billing.scheduledChangeDate': null,
        };
        await this.userModel.findByIdAndUpdate(userId, { $set: update });

        if (executionsDelta > 0) {
            await this.usersService.addExecutions(
                userId,
                executionsDelta,
                EXECUTION_ACTION.PLAN_CHANGE
            );
        }

        return { scheduled: false };
    }

    async updateCard(
        userId: string,
        returnPath?: string
    ): Promise<{ checkoutUrl: string }> {
        return this.withBillingLock(userId, () =>
            this.updateCardLocked(userId, returnPath)
        );
    }

    private async updateCardLocked(
        userId: string,
        returnPath?: string
    ): Promise<{ checkoutUrl: string }> {
        const { user, billing } = await this.requireActiveSubscription(userId);
        const oldOrderReference = billing.orderReference!;

        const plan = findSubscriptionPlan(billing.planCode ?? '');
        if (!plan) {
            throw new BadRequestException({
                code: RESPONSE_CODE.INVALID_PLAN,
                message: 'Subscription plan no longer exists',
            });
        }

        // Re-bind = cancel old + create new зі збереженням плану і дати
        // наступного списання (без негайної повторної оплати поточного періоду).
        await this.removeRecurringWithRetry(oldOrderReference, 'card_rebind');

        const newOrderReference = buildSubscriptionOrderReference(userId);
        const result = await this.paymentProvider.createSubscriptionCheckout({
            userId,
            userEmail: user.email,
            orderReference: newOrderReference,
            planName: this.planLabel(plan.code),
            amount: plan.priceAmount,
            currency: plan.currency,
            interval: plan.interval,
            firstChargeDate: billing.currentPeriodEnd ?? undefined,
            serviceUrl: this.serviceUrl(),
            returnUrl: this.returnUrl(returnPath),
        });

        await this.userModel.findByIdAndUpdate(userId, {
            $set: {
                'billing.orderReference': newOrderReference,
                'billing.recToken': null,
                'billing.cardMask': null,
                // Стара рекурента знята, нова ще не підтверджена. Прапорець дає
                // cleanup-cron експайрити доступ, якщо користувач кине re-bind
                // і період мине (інакше hasActiveSubscription лишився б true
                // назавжди без жодного списання). Чистить перший approved-вебхук
                // на новому orderReference.
                'billing.rebindPendingAt': new Date(),
            },
        });

        return { checkoutUrl: result.checkoutUrl };
    }

    // ── Payment history ──────────────────────────────────────────────────

    async listPayments(
        userId: string,
        limit: number
    ): Promise<PaymentRecordLean[]> {
        return this.paymentRecordModel
            .find({ userId: new Types.ObjectId(userId) })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
    }

    // ── Reset (REMOVE recurring + clear local) ───────────────────────────

    async resetBilling(userId: string): Promise<void> {
        return this.withBillingLock(userId, () =>
            this.resetBillingLocked(userId)
        );
    }

    private async resetBillingLocked(userId: string): Promise<void> {
        const user = await this.userModel.findById(userId).lean();
        if (!user) {
            throw new BadRequestException({
                code: RESPONSE_CODE.NOT_FOUND,
                message: 'User not found',
            });
        }

        const orderReference = user.billing?.orderReference;
        const previousBalance = user.executions.balance;

        if (previousBalance > 0) {
            await this.usersService.recordTransaction({
                userId,
                type: EXECUTION_TRANSACTION_TYPE.DEBIT,
                action: EXECUTION_ACTION.BILLING_RESET,
                amount: previousBalance,
                balanceAfter: 0,
            });
        }

        await this.userModel.findByIdAndUpdate(userId, {
            $set: {
                billing: null,
                executions: { balance: 0, freeReportUsed: false },
            },
        });
        await this.webhookEventModel.deleteMany({ userId });
        await this.paymentRecordModel.deleteMany({
            userId: new Types.ObjectId(userId),
        });
        await this.usersService.clearTransactions(userId);

        if (orderReference && user.billing?.hasActiveSubscription) {
            await this.removeRecurringWithRetry(
                orderReference,
                'billing_reset'
            );
        }

        this.logger.log(`Billing reset for user ${userId}`);
    }

    // ── Webhook ──────────────────────────────────────────────────────────

    async handleWebhook(
        rawBody: Buffer
    ): Promise<Record<string, unknown> | null> {
        const { event, acceptResponse } =
            await this.paymentProvider.parseWebhook(rawBody);
        if (!event) {
            return null;
        }

        const parsed = parseOrderReference(event.orderReference);
        if (!parsed) {
            // Валідний підпис, але orderReference не наш (напр. prorate-Charge,
            // що обробляється синхронно): ack, щоб WayForPay не слав повтори.
            this.logger.debug(
                `Unrecognized orderReference ${event.orderReference}, acked without routing`
            );
            return acceptResponse;
        }

        try {
            // Серіалізуємо обробку вебхука тим самим per-user локом, що й
            // user-мутації. Без цього renewal-колбек, що приземлився під час
            // changePlan/cancel, конкурував би з їх (негардованим) записом
            // billing і міг затерти план/період.
            await this.withBillingLock(parsed.userId, () =>
                this.routeTransaction(event, parsed)
            );
        } catch (error) {
            if (isBillingLockBusy(error)) {
                // Користувач саме виконує білінг-мутацію. НЕ повертаємо accept —
                // WayForPay передоставить подію, обробимо після звільнення локу.
                this.logger.debug(
                    `Webhook ${event.providerEventId} deferred: billing lock busy for user ${parsed.userId}`
                );
                return null;
            }
            this.logger.error(
                `Failed to process webhook ${event.providerEventId}`,
                error instanceof Error ? error.stack : String(error)
            );
            // НЕ повертаємо accept: pending-запис уже відкочено
            // (`routeTransaction` rollback), тож повторна доставка WayForPay
            // переобробить подію з нуля. Якби ми тут віддали accept, провайдер
            // не переслав би — і реальне списання лишилось би незарахованим.
            return null;
        }

        return acceptResponse;
    }

    private async routeTransaction(
        event: BillingWebhookEvent,
        parsed: ParsedOrderReference
    ): Promise<void> {
        const userId = parsed.userId;
        const insert = await this.insertWebhookEvent(event, userId);
        if (insert !== 'new') {
            // 'applied' (already processed) або 'pending' (інша доставка цієї ж
            // події вже в обробці, або crash-orphan, який добиває cron-sweep).
            // НЕ переобробляємо: pack-ефект (`addExecutions`) не ідемпотентний,
            // тож повторний прогін під час конкурентної доставки задвоїв би
            // нарахування.
            return;
        }

        // Усі side-effects події + перехід webhook-події pending→applied — в
        // одній транзакції. Flip статусу = атомарний commit-маркер: грант,
        // billing-update і payment-record комітяться РАЗОМ зі статусом 'applied'
        // або не комітяться зовсім. Частковий збій (напр. addExecutions кинув
        // після billing-update) відкочує все, лишає подію 'pending', і catch її
        // видаляє → передоставка WayForPay переобробляє з нуля. Без транзакції
        // out-of-order CAS на lastProviderEventAt заблокував би повторний грант,
        // і оплачені executions губились би назавжди.
        const session = await this.connection.startSession();
        try {
            await session.withTransaction(async () => {
                if (parsed.kind === ORDER_KIND.PACK) {
                    await this.applyPackTransaction(
                        event,
                        parsed.packCode,
                        userId,
                        session
                    );
                } else {
                    await this.applySubscriptionTransaction(
                        event,
                        userId,
                        session
                    );
                }
                await this.webhookEventModel.updateOne(
                    {
                        provider: PROVIDER,
                        providerEventId: event.providerEventId,
                    },
                    { $set: { status: 'applied' } },
                    { session }
                );
            });
        } catch (error) {
            await this.rollbackPendingWebhookEvent(event.providerEventId);
            throw error;
        } finally {
            await session.endSession();
        }
    }

    private async applyPackTransaction(
        event: BillingWebhookEvent,
        packCode: string,
        userId: string,
        session: ClientSession
    ): Promise<void> {
        if (event.transactionStatus === WAYFORPAY_TRANSACTION_STATUS.REFUNDED) {
            await this.markRefunded(event, session);
            return;
        }
        // Проміжний колбек (InProcessing/Pending) не пишемо у історію — інакше
        // лишився б фальшивий рядок «Відхилено» поряд із фінальним «Сплачено».
        if (
            NON_TERMINAL_TRANSACTION_STATUSES.includes(event.transactionStatus)
        ) {
            return;
        }
        if (event.transactionStatus !== WAYFORPAY_TRANSACTION_STATUS.APPROVED) {
            await this.recordPayment(
                {
                    userId,
                    orderReference: event.orderReference,
                    type: PAYMENT_RECORD_TYPE.PACK,
                    amount: event.amount,
                    currency: event.currency,
                    status: PAYMENT_RECORD_STATUS.DECLINED,
                    providerTransactionId: event.transactionId,
                    cardMask: event.cardMask,
                },
                session
            );
            return;
        }

        const pack = findExecutionPack(packCode);
        if (!pack) {
            this.logger.warn(`Unknown packCode ${packCode} in webhook`);
            return;
        }

        // Грант executions неідемпотентний ($inc), але комітиться в одній
        // транзакції з flip-ом події pending→applied (`routeTransaction`).
        // Дубль-доставка ловиться unique-індексом на (provider, providerEventId)
        // у `insertWebhookEvent` ще до транзакції, тож повторний грант неможливий.
        await this.usersService.addExecutions(
            userId,
            pack.executions,
            EXECUTION_ACTION.PACK_PURCHASE,
            session
        );
        await this.recordPayment(
            {
                userId,
                orderReference: event.orderReference,
                type: PAYMENT_RECORD_TYPE.PACK,
                amount: event.amount,
                currency: event.currency,
                status: PAYMENT_RECORD_STATUS.APPROVED,
                providerTransactionId: event.transactionId,
                cardMask: event.cardMask,
            },
            session
        );
        this.logger.log(
            `Pack ${packCode}: +${pack.executions} executions for user ${userId}`
        );
    }

    private async applySubscriptionTransaction(
        event: BillingWebhookEvent,
        userId: string,
        session: ClientSession
    ): Promise<void> {
        if (event.transactionStatus === WAYFORPAY_TRANSACTION_STATUS.REFUNDED) {
            await this.markRefunded(event, session);
            return;
        }
        // Проміжний колбек (InProcessing/Pending): не чіпаємо стан і не пишемо
        // платіж — фінальний статус прийде окремою подією. Без цього InProcessing
        // флипнув би підписку у PAST_DUE і зламав trial-класифікацію наступного
        // Approved (wasBinding більше не INCOMPLETE → привʼязка хибно стала б
        // renewal-списанням).
        if (
            NON_TERMINAL_TRANSACTION_STATUSES.includes(event.transactionStatus)
        ) {
            return;
        }

        const user = await this.userModel
            .findById(userId)
            .session(session)
            .lean();
        const billing = user?.billing;
        if (!billing || billing.orderReference !== event.orderReference) {
            this.logger.debug(
                `Subscription webhook for stale orderReference ${event.orderReference}, ignored`
            );
            return;
        }

        const declined =
            event.transactionStatus !== WAYFORPAY_TRANSACTION_STATUS.APPROVED;

        if (declined) {
            const updated = await this.applyBillingUpdate(
                userId,
                event,
                {
                    'billing.subscriptionStatus': SUBSCRIPTION_STATUS.PAST_DUE,
                    'billing.providerSubscriptionStatus':
                        event.transactionStatus,
                },
                session
            );
            if (updated) {
                await this.recordPayment(
                    {
                        userId,
                        orderReference: event.orderReference,
                        type: PAYMENT_RECORD_TYPE.SUBSCRIPTION,
                        amount: event.amount,
                        currency: event.currency,
                        status: PAYMENT_RECORD_STATUS.DECLINED,
                        providerTransactionId: event.transactionId,
                        cardMask: event.cardMask,
                    },
                    session
                );
            }
            return;
        }

        // Re-bind картки: перший Approved на новому orderReference після
        // updateCard. Це card-verification, не списання (реальне списання — на
        // межі періоду), тож період не рухаємо, executions не нараховуємо і
        // платіж не пишемо — лише оновлюємо токен/маску і знімаємо прапорець.
        // Без цієї гілки re-bind класифікувався б як charge: подвоїв би
        // executions і продовжив період на повний інтервал.
        if (billing.rebindPendingAt != null) {
            const rebindSet: Record<string, unknown> = {
                'billing.providerSubscriptionStatus': event.transactionStatus,
                'billing.rebindPendingAt': null,
            };
            if (event.recToken) rebindSet['billing.recToken'] = event.recToken;
            if (event.cardMask) rebindSet['billing.cardMask'] = event.cardMask;
            await this.applyBillingUpdate(userId, event, rebindSet, session);
            return;
        }

        // Approved. Класифікуємо за поточним станом: INCOMPLETE → привʼязка
        // (trial), інакше → списання (trial-end або renewal). Застосовуємо
        // запланований downgrade, якщо настала його дата.
        const wasBinding =
            billing.subscriptionStatus === SUBSCRIPTION_STATUS.INCOMPLETE;

        const scheduledDue =
            billing.scheduledPlanCode != null &&
            billing.scheduledChangeDate != null &&
            event.occurredAt.getTime() >= billing.scheduledChangeDate.getTime();
        const effectivePlanCode = scheduledDue
            ? billing.scheduledPlanCode!
            : billing.planCode;
        const plan = findSubscriptionPlan(effectivePlanCode ?? '');
        const interval = plan?.interval ?? 'month';

        const periodEnd = wasBinding
            ? (billing.currentPeriodEnd ??
              addInterval(event.occurredAt, interval))
            : addInterval(event.occurredAt, interval);

        const set: Record<string, unknown> = {
            'billing.subscriptionStatus': wasBinding
                ? SUBSCRIPTION_STATUS.TRIALING
                : SUBSCRIPTION_STATUS.ACTIVE,
            'billing.hasActiveSubscription': true,
            'billing.cancelAtPeriodEnd': false,
            'billing.providerSubscriptionStatus': event.transactionStatus,
            'billing.currentPeriodEnd': periodEnd,
            'billing.planCode': effectivePlanCode,
            'billing.scheduledPlanCode': null,
            'billing.scheduledChangeDate': null,
            'billing.rebindPendingAt': null,
        };
        if (event.recToken) set['billing.recToken'] = event.recToken;
        if (event.cardMask) set['billing.cardMask'] = event.cardMask;

        const updated = await this.applyBillingUpdate(
            userId,
            event,
            set,
            session
        );
        if (!updated) {
            return;
        }

        if (plan) {
            await this.usersService.addExecutions(
                userId,
                plan.executions,
                EXECUTION_ACTION.SUBSCRIPTION_ACTIVATION,
                session
            );
        }
        await this.recordPayment(
            {
                userId,
                orderReference: event.orderReference,
                type: PAYMENT_RECORD_TYPE.SUBSCRIPTION,
                amount: event.amount,
                currency: event.currency,
                status: PAYMENT_RECORD_STATUS.APPROVED,
                providerTransactionId: event.transactionId,
                cardMask: event.cardMask,
            },
            session
        );
        this.logger.log(
            `Subscription ${wasBinding ? 'trial-binding' : 'charge'} for user ${userId} ` +
                `(plan ${effectivePlanCode}, event ${event.providerEventId})`
        );
    }

    /**
     * Atomic billing $set з guard на out-of-order: застосовується лише якщо
     * подія новіша за останню (`lastProviderEventAt < occurredAt`). Повертає
     * true, якщо застосовано (тоді безпечно нараховувати executions).
     */
    private async applyBillingUpdate(
        userId: string,
        event: BillingWebhookEvent,
        set: Record<string, unknown>,
        session: ClientSession
    ): Promise<boolean> {
        const updated = await this.userModel.findOneAndUpdate(
            {
                _id: userId,
                billing: { $ne: null },
                $or: [
                    { 'billing.lastProviderEventAt': null },
                    {
                        'billing.lastProviderEventAt': {
                            $lt: event.occurredAt,
                        },
                    },
                ],
            },
            {
                $set: {
                    ...set,
                    'billing.lastProviderEventAt': event.occurredAt,
                },
            },
            { new: true, session, maxTimeMS: WEBHOOK_MONGO_TIMEOUT_MS }
        );
        if (!updated) {
            this.logger.debug(
                `Stale subscription event ${event.providerEventId} for user ${userId}, skipped`
            );
        }
        return updated != null;
    }

    private async markRefunded(
        event: BillingWebhookEvent,
        session: ClientSession
    ): Promise<void> {
        const update = {
            $set: {
                status: PAYMENT_RECORD_STATUS.REFUNDED,
                refundAmount: event.amount,
            },
        };
        const options = { sort: { createdAt: -1 as const }, session };

        // 1) Точний збіг за transactionId оригінального списання. Покриває і
        //    ідемпотентність (cancel-with-refund уже відмітив цей запис
        //    синхронно — повторний колбек лише перезапише ті самі значення), і
        //    зовнішній refund конкретної транзакції.
        if (event.transactionId) {
            const byTxn = await this.paymentRecordModel.findOneAndUpdate(
                {
                    orderReference: event.orderReference,
                    providerTransactionId: event.transactionId,
                },
                update,
                options
            );
            if (byTxn) return;
        }

        // 2) Fallback — APPROVED-списання з ТОЧНО такою ж сумою (повний refund
        //    без впізнаваного transactionId). Свідомо НЕ мітимо «найновіше
        //    APPROVED будь-якої суми»: партіальний refund (cancel-with-refund)
        //    інакше зіпсував би інше валідне списання, бо його сума не збігається
        //    з жодним повним списанням під цим orderReference, а сам refund уже
        //    відмічено синхронно.
        await this.paymentRecordModel.findOneAndUpdate(
            {
                orderReference: event.orderReference,
                status: PAYMENT_RECORD_STATUS.APPROVED,
                amount: event.amount,
            },
            update,
            options
        );
    }

    // ── Idempotency primitives ───────────────────────────────────────────

    private async insertWebhookEvent(
        event: BillingWebhookEvent,
        userId: string
    ): Promise<'new' | 'skip'> {
        try {
            await this.webhookEventModel.create({
                provider: PROVIDER,
                providerEventId: event.providerEventId,
                receivedAt: new Date(),
                occurredAt: event.occurredAt,
                type: event.transactionStatus,
                userId,
                packCode: null,
                status: 'pending',
            });
            return 'new';
        } catch (error: unknown) {
            if (isDuplicateKeyError(error)) {
                // Унікальний індекс (provider, providerEventId) гарантує одного
                // творця pending-запису. Будь-яка інша доставка тієї ж події —
                // дублікат: вона НЕ застосовує ефекти. 'applied' = вже
                // оброблено; 'pending' = творець ще в обробці (або crash-orphan,
                // який добиває `PaymentsCleanupService` stale-sweep).
                const existing = await this.webhookEventModel
                    .findOne({
                        provider: PROVIDER,
                        providerEventId: event.providerEventId,
                    })
                    .lean();
                this.logger.debug(
                    `Duplicate webhook event ${event.providerEventId} ` +
                        `(status ${existing?.status ?? 'unknown'}), skipped`
                );
                return 'skip';
            }
            throw error;
        }
    }

    private async rollbackPendingWebhookEvent(
        providerEventId: string
    ): Promise<void> {
        try {
            await this.webhookEventModel.deleteOne({
                provider: PROVIDER,
                providerEventId,
                status: 'pending',
            });
        } catch (error) {
            this.logger.error(
                `Failed to rollback pending webhook event ${providerEventId}`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private async requireActiveSubscription(userId: string) {
        const user = await this.userModel.findById(userId).lean();
        if (
            !user?.billing?.hasActiveSubscription ||
            !user.billing.orderReference
        ) {
            throw new BadRequestException({
                code: RESPONSE_CODE.NO_ACTIVE_SUBSCRIPTION,
                message: 'No active subscription',
            });
        }
        return { user, billing: user.billing };
    }

    private async recordPayment(
        data: {
            userId: string;
            orderReference: string;
            type: PaymentRecordType;
            amount: number;
            currency: string;
            status: (typeof PAYMENT_RECORD_STATUS)[keyof typeof PAYMENT_RECORD_STATUS];
            providerTransactionId: string | null;
            cardMask: string | null;
        },
        session?: ClientSession
    ): Promise<void> {
        await this.paymentRecordModel.create(
            [
                {
                    userId: new Types.ObjectId(data.userId),
                    orderReference: data.orderReference,
                    type: data.type,
                    amount: data.amount,
                    currency: data.currency,
                    status: data.status,
                    providerTransactionId: data.providerTransactionId,
                    cardMask: data.cardMask,
                    refundAmount: null,
                },
            ],
            { session }
        );
    }

    /**
     * REMOVE рекуренту: при збої НЕ кидаємо (локальне скасування/re-bind має
     * завершитись для користувача), але ставимо orderReference у retry-чергу —
     * `PaymentsCleanupService` добиває REMOVE, інакше WayForPay списував би далі
     * зі скасованої підписки.
     */
    private async removeRecurringWithRetry(
        orderReference: string,
        reason: string
    ): Promise<void> {
        try {
            await this.paymentProvider.removeSubscription(orderReference);
        } catch (error) {
            this.logger.error(
                `Failed to REMOVE recurring ${orderReference} (${reason}), queued for retry`,
                error instanceof Error ? error.stack : String(error)
            );
            await this.enqueueFailedRemoval(orderReference, reason);
        }
    }

    private async enqueueFailedRemoval(
        orderReference: string,
        reason: string
    ): Promise<void> {
        try {
            await this.failedRemovalModel.create({
                provider: PROVIDER,
                orderReference,
                reason,
                failedAt: new Date(),
                attempts: 0,
                lastAttemptAt: null,
            });
        } catch (error: unknown) {
            if (isDuplicateKeyError(error)) return;
            throw error;
        }
    }

    /**
     * CHANGE рекуренту (сума/інтервал/дата): при збої кидаємо mapped-помилку.
     * CHANGE не має retry-черги, а тихий збій лишив би рекурент з невірною
     * сумою/датою (недо/переплата на наступних циклах) непомітно. Краще явна
     * помилка користувачу, ніж мовчазний дрейф білінгу.
     */
    private async changeRecurringOrThrow(
        orderReference: string,
        change: SubscriptionChange
    ): Promise<void> {
        try {
            await this.paymentProvider.changeSubscription(
                orderReference,
                change
            );
        } catch (error) {
            this.logger.error(
                `Failed to CHANGE recurring ${orderReference}`,
                error instanceof Error ? error.stack : String(error)
            );
            throw new BadRequestException({
                code: RESPONSE_CODE.SUBSCRIPTION_OPERATION_FAILED,
                message: 'Subscription change failed',
            });
        }
    }

    /**
     * Best-effort повернення proration-доплати, коли апгрейд не завершився.
     * Не кидає: caller і так re-throw-ить початкову помилку CHANGE. Якщо й
     * refund впав — гроші зависли, логуємо ERROR для ручного розбору.
     */
    private async refundProration(
        orderReference: string,
        amount: number,
        currency: string
    ): Promise<void> {
        try {
            const result = await this.paymentProvider.refund({
                orderReference,
                amount,
                currency,
                comment: 'Повернення доплати: апгрейд плану не завершився',
            });
            if (!result.success) {
                this.logger.error(
                    `Proration refund declined for ${orderReference} ` +
                        `(reason ${result.reason ?? '?'}), manual review required`
                );
                return;
            }
            await this.paymentRecordModel.updateOne(
                { orderReference },
                {
                    $set: {
                        status: PAYMENT_RECORD_STATUS.REFUNDED,
                        refundAmount: amount,
                    },
                }
            );
        } catch (error) {
            this.logger.error(
                `Proration refund failed for ${orderReference}, manual review required`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    private freshBilling(partial: {
        orderReference: string;
        planCode: string;
        currency: string;
        subscriptionStatus: string;
        currentPeriodEnd: Date;
    }): NonNullable<UserDocument['billing']> {
        return {
            provider: PROVIDER,
            orderReference: partial.orderReference,
            recToken: null,
            cardMask: null,
            planCode: partial.planCode,
            currency: partial.currency,
            subscriptionStatus: partial.subscriptionStatus,
            providerSubscriptionStatus: null,
            currentPeriodEnd: partial.currentPeriodEnd,
            cancelAtPeriodEnd: false,
            hasActiveSubscription: false,
            lastProviderEventAt: null,
            scheduledPlanCode: null,
            scheduledChangeDate: null,
            rebindPendingAt: null,
        };
    }

    private planInterval(planCode: string | null): BillingInterval {
        return findSubscriptionPlan(planCode ?? '')?.interval ?? 'month';
    }

    private planLabel(code: string): string {
        return `Підписка ${findSubscriptionPlan(code)?.name ?? code}`;
    }

    private packLabel(code: string): string {
        return `Пакет виконань ${findExecutionPack(code)?.name ?? code}`;
    }

    private serviceUrl(): string {
        return `${ENV.WEB_URL}/api/payments/webhook/${PROVIDER}`;
    }

    private returnUrl(returnPath?: string): string {
        const query = returnPath
            ? `?returnPath=${encodeURIComponent(returnPath)}`
            : '';
        return `${ENV.WEB_URL}/billing/success${query}`;
    }

    private disabled(): BadRequestException {
        return new BadRequestException({
            code: RESPONSE_CODE.PAYMENT_TYPE_DISABLED,
            message: 'Payment type is disabled',
        });
    }
}

// ── Module-level pure helpers ────────────────────────────────────────────

function isDuplicateKeyError(error: unknown): boolean {
    return (
        error instanceof Error &&
        'code' in error &&
        (error as { code: number }).code === 11000
    );
}

/** Лок-контенція з `withBillingLock` (не помилка обробки — підстава для retry). */
function isBillingLockBusy(error: unknown): boolean {
    return (
        error instanceof ConflictException &&
        (error.getResponse() as { code?: string })?.code ===
            RESPONSE_CODE.BILLING_OPERATION_IN_PROGRESS
    );
}

function addMonths(date: Date, months: number): Date {
    const next = new Date(date);
    next.setMonth(next.getMonth() + months);
    return next;
}

function addInterval(date: Date, interval: BillingInterval): Date {
    const next = new Date(date);
    if (interval === 'year') {
        next.setFullYear(next.getFullYear() + 1);
    } else {
        next.setMonth(next.getMonth() + 1);
    }
    return next;
}

/**
 * Частка невикористаного періоду на момент now: `(periodEnd - now) /
 * intervalLength`. Clamp [0,1]. periodStart похідний від periodEnd - інтервал.
 */
function remainingRatio(
    periodEnd: Date | null,
    interval: BillingInterval
): number {
    if (!periodEnd) return 0;
    const end = periodEnd.getTime();
    const start =
        interval === 'year'
            ? subYears(periodEnd).getTime()
            : subMonths(periodEnd).getTime();
    const now = Date.now();
    const total = end - start;
    if (total <= 0) return 0;
    return Math.max(0, Math.min(1, (end - now) / total));
}

function subMonths(date: Date): Date {
    const d = new Date(date);
    d.setMonth(d.getMonth() - 1);
    return d;
}

function subYears(date: Date): Date {
    const d = new Date(date);
    d.setFullYear(d.getFullYear() - 1);
    return d;
}
