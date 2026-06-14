import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    Logger,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
    BILLING_CURRENCY,
    PAYMENT_RECORD_STATUS,
    PAYMENT_RECORD_TYPE,
    PAYMENT_TYPE,
    RESPONSE_CODE,
    SUBSCRIPTION_STATUS,
    WAYFORPAY_TRANSACTION_STATUS,
    findOneOffAccess,
    findSubscriptionPlan,
    type AccessLevel,
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
    type ChargeResult,
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
import { ReconciliationService } from '../businesses/reconciliation.service';
import {
    BILLING_LOCK_TTL_MS,
    billingLockKey,
} from '../../common/billing/billing-lock';
import {
    RedisLockBusyError,
    RedisLockService,
} from '../../common/services/redis-lock.service';
import {
    ORDER_KIND,
    buildOneOffOrderReference,
    buildSubscriptionOrderReference,
    parseOrderReference,
    type ParsedOrderReference,
} from './order-reference';

const WEBHOOK_MONGO_TIMEOUT_MS = 10_000;
const PROVIDER = 'wayforpay';

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

        @InjectConnection()
        private readonly connection: Connection,

        private readonly usersService: UsersService,

        private readonly reconciliation: ReconciliationService,

        private readonly locks: RedisLockService
    ) {}

    /**
     * Серіалізує білінг-write-операції одного користувача per-user Redis-локом
     * (`RedisLockService` + спільний ключ з `billing-lock.ts` — той самий
     * мьютекс тримає і `ReconciliationService.reconcileUnderLock`). WayForPay
     * charge/refund/CHANGE неідемпотентні: два паралельні запити (дві вкладки)
     * інакше задвоїли б proration-списання чи refund. Lock зайнятий →
     * `BILLING_OPERATION_IN_PROGRESS`.
     */
    private async withBillingLock<T>(
        userId: string,
        fn: () => Promise<T>
    ): Promise<T> {
        try {
            return await this.locks.withLock(
                billingLockKey(userId),
                BILLING_LOCK_TTL_MS,
                fn
            );
        } catch (error) {
            if (error instanceof RedisLockBusyError) {
                throw new ConflictException({
                    code: RESPONSE_CODE.BILLING_OPERATION_IN_PROGRESS,
                    message: 'Billing operation already in progress',
                });
            }
            throw error;
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
        const { paymentType, planCode, oneOffCode, returnPath } = dto;

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

            // Попередня підписка (UNPAID після past-due sweep, CANCELED) могла
            // лишити живий рекурент у WayForPay: past-due sweep свідомо НЕ робить
            // REMOVE (живі ретраї лишаються провайдеру). Новий checkout
            // перезаписує billing.orderReference, тож пізніше успішне списання
            // старого рекуренту прийшло б вебхуком зі stale-reference і було б
            // проігнороване — гроші списані, доступ не зарахований. Тому перед
            // перезаписом знімаємо старий рекурент (симетрично updateCard).
            // Guard на recToken: рекурент існує лише після Approved-привʼязки;
            // без нього (кинутий INCOMPLETE-checkout) REMOVE гарантовано падав
            // би і засмічував retry-чергу.
            const previousOrderReference = user.billing?.orderReference ?? null;
            if (previousOrderReference && user.billing?.recToken) {
                await this.removeRecurringWithRetry(
                    previousOrderReference,
                    'superseded_by_new_checkout'
                );
            }

            // Trial прибрано: підписка списується одразу (firstChargeDate
            // undefined). Виняток — активний one-off: перше списання
            // відкладається на дату його закінчення (`oneOffUntil`), доступ
            // тримає one-off до того. `currentPeriodEnd` сидиться цією датою як
            // сигнал відкладеного старту для webhook-класифікації; null →
            // негайний старт. One-off поля переносимо, інакше freshBilling
            // (повна заміна субдока) стер би вже сплачений one-off.
            const oneOffUntil = activeOneOffUntil(user.billing, new Date());

            await this.userModel.findByIdAndUpdate(userId, {
                $set: {
                    billing: this.freshBilling({
                        orderReference,
                        planCode: plan.code,
                        currency: plan.currency,
                        subscriptionStatus: SUBSCRIPTION_STATUS.INCOMPLETE,
                        currentPeriodEnd: oneOffUntil,
                        oneOffLevel: user.billing?.oneOffLevel ?? null,
                        oneOffAccessUntil:
                            user.billing?.oneOffAccessUntil ?? null,
                        oneOffOrderReference:
                            user.billing?.oneOffOrderReference ?? null,
                        reconcileRequiredAt:
                            user.billing?.reconcileRequiredAt ?? null,
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
                    firstChargeDate: oneOffUntil ?? undefined,
                    serviceUrl,
                    returnUrl,
                });
            return { checkoutUrl: result.checkoutUrl };
        }

        const access = findOneOffAccess(oneOffCode ?? '');
        if (!access) {
            throw new BadRequestException({
                code: RESPONSE_CODE.INVALID_PLAN,
                message: 'Invalid oneOffCode',
            });
        }
        const orderReference = buildOneOffOrderReference(userId, access.code);
        const result = await this.paymentProvider.createOneOffCheckout({
            userId,
            userEmail: user.email,
            orderReference,
            productName: this.oneOffLabel(access.code),
            amount: access.priceAmount,
            currency: access.currency,
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

        // З поверненням за невикористаний період. Останнє списання беремо як
        // APPROVED або вже REFUNDED: повторний виклик після часткового збою
        // (refund пройшов, локальний flip не завершився) має впізнати завершене
        // повернення і не списати refund удруге. Звужуємо до списань ПОТОЧНОГО
        // періоду (createdAt ≥ межа періоду): без цього cancel підхопив би
        // списання попередньої підписки і повертав би чужі кошти. Звуження по
        // даті, а не по orderReference: після re-bind картки чинне списання
        // періоду живе на старому orderReference.
        //
        // Під час відкладеного старту (TRIALING) реального списання на цій
        // підписці ще не було (binding-вебхук не рухав коштів) — повертати
        // нічого: refund лишається null, нижче відпрацьовують лише REMOVE + flip.
        // Симетрично спец-гілці TRIALING у `changePlanLocked`.
        const interval = this.planInterval(billing.planCode);
        const lastCharge =
            billing.subscriptionStatus !== SUBSCRIPTION_STATUS.TRIALING &&
            billing.currentPeriodEnd
                ? await this.paymentRecordModel
                      .findOne({
                          userId: new Types.ObjectId(userId),
                          type: PAYMENT_RECORD_TYPE.SUBSCRIPTION,
                          status: {
                              $in: [
                                  PAYMENT_RECORD_STATUS.APPROVED,
                                  PAYMENT_RECORD_STATUS.REFUNDED,
                              ],
                          },
                          createdAt: {
                              $gte: periodLookbackStart(
                                  billing.currentPeriodEnd,
                                  interval
                              ),
                          },
                      })
                      .sort({ createdAt: -1 })
                      .lean()
                : null;

        let refundedAmount: number | null = null;

        if (lastCharge?.status === PAYMENT_RECORD_STATUS.REFUNDED) {
            // Уже повернуто попередньою спробою — лишилось добити REMOVE + flip.
            refundedAmount = lastCharge.refundAmount;
        } else if (lastCharge) {
            const refundAmount = Math.round(
                lastCharge.amount *
                    remainingRatio(billing.currentPeriodEnd, interval)
            );
            if (refundAmount > 0) {
                // Claim-first: атомарно мітимо REFUNDED ДО виклику провайдера.
                // refund впав → відкочуємо мітку (гроші не рухались, повтор
                // спробує знову). refund пройшов, а наступні кроки впали →
                // повторний виклик побачить REFUNDED і не списуватиме повторно.
                const claimed = await this.paymentRecordModel.findOneAndUpdate(
                    {
                        _id: lastCharge._id,
                        status: PAYMENT_RECORD_STATUS.APPROVED,
                    },
                    {
                        $set: {
                            status: PAYMENT_RECORD_STATUS.REFUNDED,
                            refundAmount,
                        },
                    },
                    { new: true }
                );
                if (claimed) {
                    let result;
                    try {
                        // Refund адресуємо order-у самого списання: після
                        // re-bind поточний billing.orderReference ще не має
                        // жодної транзакції, повертати можна лише з того
                        // order-а, де гроші реально рухались.
                        result = await this.paymentProvider.refund({
                            orderReference: lastCharge.orderReference,
                            amount: refundAmount,
                            currency: billing.currency ?? BILLING_CURRENCY,
                            comment:
                                'Скасування підписки з поверненням за невикористаний період',
                        });
                    } catch (error) {
                        // Транспортний збій (timeout/network/HTTP): результат
                        // refund-а НЕВІДОМИЙ — на timeout гроші могли рухатись.
                        // Мітку НЕ відкочуємо (повтор не сміє списати refund
                        // удруге), але це означає, що повторний cancel пропустить
                        // refund назавжди — тому гучний ERROR на ручний розбір,
                        // а користувачу мапована помилка замість success-тоста.
                        this.logger.error(
                            `Refund transport failure for ${lastCharge.orderReference} ` +
                                `(record ${String(lastCharge._id)} kept REFUNDED), ` +
                                `manual review required`,
                            error instanceof Error ? error.stack : String(error)
                        );
                        throw new BadRequestException({
                            code: RESPONSE_CODE.REFUND_FAILED,
                            message: 'Refund failed',
                        });
                    }
                    if (!result.success) {
                        // Провайдер явно відхилив: гроші не рухались — безпечно
                        // відкотити мітку, повтор спробує знову.
                        await this.paymentRecordModel.updateOne(
                            { _id: lastCharge._id },
                            {
                                $set: {
                                    status: PAYMENT_RECORD_STATUS.APPROVED,
                                    refundAmount: null,
                                },
                            }
                        );
                        throw new BadRequestException({
                            code: RESPONSE_CODE.REFUND_FAILED,
                            message: 'Refund failed',
                        });
                    }
                }
                refundedAmount = refundAmount;
            }
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

        // Доступ міг впасти (до one-off-рівня або none) — блокуємо зайві бізнеси.
        await this.reconcileSafe(userId);

        return { refundedAmount };
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

        // Відкладений старт поверх one-off (TRIALING): першого списання ще не
        // було, тож proration нема за що рахувати, а доплата не підняла б
        // доступ (deriveAccessLevel свідомо не зараховує TRIALING — рівень до
        // межі тримає one-off). Будь-яка зміна плану тут — лише заміна того,
        // що почне списуватись на межі: CHANGE суми рекурента + локальний
        // planCode, без списання і без reconcile (рівень не змінився).
        if (billing.subscriptionStatus === SUBSCRIPTION_STATUS.TRIALING) {
            await this.changeRecurringOrThrow(orderReference, {
                amount: target.priceAmount,
                currency: target.currency,
                interval: target.interval,
            });
            await this.userModel.findByIdAndUpdate(userId, {
                $set: {
                    'billing.planCode': target.code,
                    'billing.scheduledPlanCode': null,
                    'billing.scheduledChangeDate': null,
                },
            });
            return { scheduled: false };
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
        let prorationCharge: ChargeResult | null = null;
        if (prorationAmount > 0) {
            prorationRef = `fin-prorate-${userId}-${Date.now().toString(36)}`;
            prorationCharge = await this.paymentProvider.chargeByToken({
                orderReference: prorationRef,
                recToken: billing.recToken,
                amount: prorationAmount,
                currency: target.currency,
                description: `Доплата за апгрейд плану ${this.planLabel(target.code)}`,
            });
            if (!prorationCharge.success) {
                throw new BadRequestException({
                    code: RESPONSE_CODE.PRORATION_PAYMENT_FAILED,
                    message: 'Proration charge declined',
                });
            }
        }

        // Після успішного списання БУДЬ-ЯКИЙ збій (запис платежу чи CHANGE) має
        // повернути доплату. Інакше повторний апгрейд згенерував би новий
        // orderReference і списав різницю вдруге, а користувач лишився б зі
        // сплаченою, але незастосованою доплатою (план/рекурент старі). Тільки
        // після успішного CHANGE піднімаємо план.
        try {
            if (prorationRef && prorationCharge) {
                await this.recordPayment({
                    userId,
                    orderReference: prorationRef,
                    type: PAYMENT_RECORD_TYPE.PRORATION,
                    amount: prorationAmount,
                    currency: target.currency,
                    status: PAYMENT_RECORD_STATUS.APPROVED,
                    providerTransactionId: prorationCharge.transactionId,
                    cardMask: prorationCharge.cardMask ?? billing.cardMask,
                });
            }
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

        const update: Record<string, unknown> = {
            'billing.planCode': target.code,
            'billing.scheduledPlanCode': null,
            'billing.scheduledChangeDate': null,
        };
        await this.userModel.findByIdAndUpdate(userId, { $set: update });

        // Рівень міг зрости (brand→bookkeeper) — знімаємо блокування з бізнесів
        // у межах нового рівня. Downgrade scheduled-шлях reconcile не потребує:
        // план перемкнеться на межі через renewal-вебхук, який reconcile сам.
        await this.reconcileSafe(userId);

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

        // Маркер незавершеного re-bind ДО зняття старого рекуренту: збій
        // будь-якого з наступних кроків (REMOVE, checkout-виклик, фінальний
        // $set) інакше лишав би hasActiveSubscription=true без рекуренту і поза
        // всіма sweep-ами назавжди — `expireAbandonedRebinds` ловить лише
        // rebindPendingAt ≠ null. Конкурентний вебхук не вклиниться: handleWebhook
        // тримає той самий білінг-лок. Успішна привʼязка (Approved на новому
        // orderReference) чистить маркер.
        await this.userModel.findByIdAndUpdate(userId, {
            $set: { 'billing.rebindPendingAt': new Date() },
        });

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

        let shouldAck: boolean;
        try {
            // Серіалізуємо обробку вебхука тим самим per-user локом, що й
            // user-мутації. Без цього renewal-колбек, що приземлився під час
            // changePlan/cancel, конкурував би з їх (негардованим) записом
            // billing і міг затерти план/період.
            shouldAck = await this.withBillingLock(parsed.userId, () =>
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

        // shouldAck=false → подія застрягла як pending crash-orphan: НЕ
        // підтверджуємо, щоб WayForPay передоставляв до stale-sweep.
        return shouldAck ? acceptResponse : null;
    }

    private async routeTransaction(
        event: BillingWebhookEvent,
        parsed: ParsedOrderReference
    ): Promise<boolean> {
        const userId = parsed.userId;
        const insert = await this.insertWebhookEvent(
            event,
            userId,
            parsed.kind === ORDER_KIND.ONE_OFF ? parsed.oneOffCode : null
        );
        if (insert === 'applied') {
            // Подію вже застосовано — звичайний дубль доставки. Підтверджуємо.
            // НЕ переобробляємо: one-off-грант доступу не ідемпотентний.
            return true;
        }
        if (insert === 'pending') {
            // Crash-orphan незавершеної обробки (живий творець утримує per-user
            // лок, тож побачити pending тут можна лише після краху процесу): ефект
            // НЕ застосовано. НЕ підтверджуємо — WayForPay передоставлятиме подію,
            // доки `sweepStalePendingEvents` не прибере orphan і наступна доставка
            // не обробить її з нуля. ack тут втратив би оплачену подію назавжди.
            this.logger.warn(
                `Webhook ${event.providerEventId} is a pending crash-orphan, not acked`
            );
            return false;
        }

        // Усі side-effects події + перехід webhook-події pending→applied — в
        // одній транзакції. Flip статусу = атомарний commit-маркер: грант
        // доступу, billing-update і payment-record комітяться РАЗОМ зі статусом
        // 'applied' або не комітяться зовсім. Частковий збій (напр. billing-write
        // кинув після payment-record) відкочує все, лишає подію 'pending', і
        // catch її видаляє → передоставка WayForPay переобробляє з нуля. Без
        // транзакції out-of-order CAS на lastProviderEventAt заблокував би
        // повторний грант, і оплачений доступ губився б назавжди.
        const session = await this.connection.startSession();
        try {
            await session.withTransaction(async () => {
                if (parsed.kind === ORDER_KIND.ONE_OFF) {
                    await this.applyOneOffTransaction(
                        event,
                        parsed.oneOffCode,
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
        // Доступ міг піднятись (активація підписки / грант one-off) — знімаємо
        // блокування з бізнесів у межах нового рівня. Після commit-у TX, тож
        // reconcile бачить актуальний білінг-стан.
        await this.reconcileSafe(userId);
        return true;
    }

    private async applyOneOffTransaction(
        event: BillingWebhookEvent,
        oneOffCode: string,
        userId: string,
        session: ClientSession
    ): Promise<void> {
        if (event.transactionStatus === WAYFORPAY_TRANSACTION_STATUS.REFUNDED) {
            await this.markRefunded(event, session);
            // Повернення one-off знімає орендований доступ; post-TX reconcile
            // (routeTransaction) заблокує зайві бізнеси за новим рівнем. Гасимо
            // слот ЛИШЕ якщо його тримає саме ця покупка (overwrite-модель:
            // слот один, новіша покупка перезаписує): refund старішої покупки,
            // чий грант уже перезаписано, не має зачіпати чинний оплачений
            // доступ — guard у filter-і робить це atomically.
            await this.userModel.updateOne(
                {
                    _id: userId,
                    'billing.oneOffOrderReference': event.orderReference,
                },
                {
                    $set: {
                        'billing.oneOffLevel': null,
                        'billing.oneOffAccessUntil': null,
                        'billing.oneOffOrderReference': null,
                    },
                },
                { session }
            );
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
                    type: PAYMENT_RECORD_TYPE.ONE_OFF,
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

        const access = findOneOffAccess(oneOffCode);
        if (!access) {
            this.logger.warn(`Unknown oneOffCode ${oneOffCode} in webhook`);
            return;
        }

        // One-off дає орендований доступ до рівня з датою закінчення (свіжий
        // місяць від моменту оплати — перезаписуємо, без додавання залишку,
        // рішення Q1). Грант неідемпотентний, але комітиться в одній транзакції
        // з flip-ом події pending→applied; дубль-доставка ловиться unique-
        // індексом (provider, providerEventId) ще до транзакції. One-off НЕ
        // використовує lastProviderEventAt-CAS (спільний watermark із підпискою):
        // це одинична подія, а її ідемпотентність уже гарантує webhook-індекс.
        const accessUntil = addMonths(event.occurredAt, access.durationMonths);
        const owner = await this.userModel
            .findById(userId)
            .session(session)
            .lean();
        if (owner?.billing) {
            await this.userModel.updateOne(
                { _id: userId },
                {
                    $set: {
                        'billing.oneOffLevel': access.level,
                        'billing.oneOffAccessUntil': accessUntil,
                        'billing.oneOffOrderReference': event.orderReference,
                    },
                },
                { session }
            );
        } else {
            await this.userModel.updateOne(
                { _id: userId },
                {
                    $set: {
                        billing: this.freshOneOffBilling(
                            access.level,
                            accessUntil,
                            event.currency,
                            event.orderReference
                        ),
                    },
                },
                { session }
            );
        }
        await this.recordPayment(
            {
                userId,
                orderReference: event.orderReference,
                type: PAYMENT_RECORD_TYPE.ONE_OFF,
                amount: event.amount,
                currency: event.currency,
                status: PAYMENT_RECORD_STATUS.APPROVED,
                providerTransactionId: event.transactionId,
                cardMask: event.cardMask,
            },
            session
        );
        this.logger.log(
            `One-off ${oneOffCode}: access ${access.level} until ` +
                `${accessUntil.toISOString()} for user ${userId}`
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
            await this.handleStaleSubscriptionEvent(event, userId, session);
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

        // Approved. Trial прибрано: за замовчуванням перший Approved (INCOMPLETE)
        // — це реальне списання → ACTIVE, період = occurredAt + інтервал. Виняток
        // — відкладений старт поверх one-off: при checkout-і `currentPeriodEnd`
        // сидиться датою закінчення one-off у майбутньому; такий перший Approved
        // — лише привʼязка картки (deferred binding) → TRIALING до тієї дати,
        // реальне списання прийде окремим Approved на межі (тоді status уже не
        // INCOMPLETE → гілка списання → ACTIVE). Застосовуємо запланований
        // downgrade, якщо настала його дата.
        const wasBinding =
            billing.subscriptionStatus === SUBSCRIPTION_STATUS.INCOMPLETE;
        const isDeferredStart =
            wasBinding &&
            billing.currentPeriodEnd != null &&
            billing.currentPeriodEnd.getTime() > event.occurredAt.getTime();

        const scheduledDue =
            billing.scheduledPlanCode != null &&
            billing.scheduledChangeDate != null &&
            event.occurredAt.getTime() >= billing.scheduledChangeDate.getTime();
        const effectivePlanCode = scheduledDue
            ? billing.scheduledPlanCode!
            : billing.planCode;
        const plan = findSubscriptionPlan(effectivePlanCode ?? '');
        const interval = plan?.interval ?? 'month';

        const periodEnd = isDeferredStart
            ? billing.currentPeriodEnd!
            : addInterval(event.occurredAt, interval);

        const set: Record<string, unknown> = {
            'billing.subscriptionStatus': isDeferredStart
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
            `Subscription ${isDeferredStart ? 'deferred-binding' : 'charge'} for user ${userId} ` +
                `(plan ${effectivePlanCode}, event ${event.providerEventId})`
        );
    }

    /**
     * Подія підписки на orderReference, що вже не є чинним для користувача
     * (перезаписаний новим checkout-ом або re-bind-ом). Без руху грошей
     * (declined-ретраї знятого рекуренту) — тихий ack, як і раніше. Approved —
     * реальне списання «нічийного» рекуренту (можливий шлях: кинутий
     * INCOMPLETE-checkout без recToken → REMOVE при перезапису пропущено →
     * пізня оплата зі ще відкритої вкладки активувала рекурент): тихий ack
     * ховав би щомісячні списання без гранту назавжди. Тому ERROR на ручний
     * розбір (refund), запис в історію (тип UNMATCHED — поза refund-скоупом
     * cancel-у) і REMOVE роуг-рекуренту через retry-чергу. Все в одній TX з
     * flip-ом події: ack лише разом зі слідом.
     */
    private async handleStaleSubscriptionEvent(
        event: BillingWebhookEvent,
        userId: string,
        session: ClientSession
    ): Promise<void> {
        if (event.transactionStatus !== WAYFORPAY_TRANSACTION_STATUS.APPROVED) {
            this.logger.debug(
                `Subscription webhook for stale orderReference ${event.orderReference}, ignored`
            );
            return;
        }
        this.logger.error(
            `Money charged on stale orderReference ${event.orderReference} for user ${userId} ` +
                `(event ${event.providerEventId}, amount ${event.amount} ${event.currency}): ` +
                `no grant applied, recurring queued for REMOVE, manual refund review required`
        );
        await this.recordPayment(
            {
                userId,
                orderReference: event.orderReference,
                type: PAYMENT_RECORD_TYPE.UNMATCHED,
                amount: event.amount,
                currency: event.currency,
                status: PAYMENT_RECORD_STATUS.APPROVED,
                providerTransactionId: event.transactionId,
                cardMask: event.cardMask,
            },
            session
        );
        await this.enqueueFailedRemoval(
            event.orderReference,
            'stale_reference_charge',
            session
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
        userId: string,
        oneOffCode: string | null
    ): Promise<'new' | 'applied' | 'pending'> {
        try {
            await this.webhookEventModel.create({
                provider: PROVIDER,
                providerEventId: event.providerEventId,
                receivedAt: new Date(),
                occurredAt: event.occurredAt,
                type: event.transactionStatus,
                userId,
                oneOffCode,
                status: 'pending',
            });
            return 'new';
        } catch (error: unknown) {
            if (isDuplicateKeyError(error)) {
                // Унікальний індекс (provider, providerEventId) гарантує одного
                // творця pending-запису. Будь-яка інша доставка тієї ж події —
                // дублікат: вона НЕ застосовує ефекти. 'applied' = подію вже
                // оброблено (безпечно ack-нути); 'pending' = crash-orphan, ефект
                // не застосовано (ack заборонений — `PaymentsCleanupService`
                // stale-sweep прибере, а WayForPay передоставить заново). Якщо
                // запис зник між create-fail і read (rollback/sweep) — теж
                // 'pending': fail-safe, повтор обробить з нуля.
                const existing = await this.webhookEventModel
                    .findOne({
                        provider: PROVIDER,
                        providerEventId: event.providerEventId,
                    })
                    .lean();
                this.logger.debug(
                    `Duplicate webhook event ${event.providerEventId} ` +
                        `(status ${existing?.status ?? 'unknown'})`
                );
                return existing?.status === 'applied' ? 'applied' : 'pending';
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

    /**
     * Реконсиляція бізнесів під новий рівень доступу — best-effort. Білінг-мутація
     * вже завершена (гроші пройшли / статус флипнуто), тож збій реконсиляції НЕ
     * має валити операцію чи un-ack-ати вебхук. Durable-маркер
     * `reconcileRequiredAt` ставиться ДО спроби (симетрично
     * `reconcileUnderLock`): без нього transient-збій усередині `reconcile` не
     * мав би наступного тригера — daily-sweep `retryPendingReconciles` добиває
     * лише стемпнутих. Повний успішний прогін знімає маркер сам (clear умовний
     * за startedAt). Викликається в межах per-user білінг-локу (без race з
     * іншими мутаціями того ж користувача).
     */
    private async reconcileSafe(userId: string): Promise<void> {
        try {
            await this.usersService.stampBillingReconcileRequired(userId);
        } catch (error) {
            this.logger.error(
                `Failed to stamp reconcileRequiredAt for user ${userId}`,
                error instanceof Error ? error.stack : String(error)
            );
        }
        try {
            await this.reconciliation.reconcile(userId);
        } catch (error) {
            this.logger.error(
                `Reconciliation failed for user ${userId} (deferred to daily retry)`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

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

    /**
     * Upsert замість create-and-swallow-11000: всередині Mongo-TX
     * (stale-charge шлях) write-помилка, навіть упіймана, абортить усю
     * транзакцію — upsert на наявному записі лишається no-op без throw.
     */
    private async enqueueFailedRemoval(
        orderReference: string,
        reason: string,
        session?: ClientSession
    ): Promise<void> {
        await this.failedRemovalModel.updateOne(
            { provider: PROVIDER, orderReference },
            {
                $setOnInsert: {
                    reason,
                    failedAt: new Date(),
                    attempts: 0,
                    lastAttemptAt: null,
                },
            },
            { upsert: true, session }
        );
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
        currentPeriodEnd: Date | null;
        oneOffLevel: string | null;
        oneOffAccessUntil: Date | null;
        oneOffOrderReference: string | null;
        reconcileRequiredAt: Date | null;
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
            oneOffLevel: partial.oneOffLevel,
            oneOffAccessUntil: partial.oneOffAccessUntil,
            oneOffOrderReference: partial.oneOffOrderReference,
            // Переносимо незнятий маркер незавершеної реконсиляції — повна
            // заміна субдока інакше загубила б його разом з retry.
            reconcileRequiredAt: partial.reconcileRequiredAt,
        };
    }

    /**
     * Білінг-субдок для one-off-гранту користувачу без наявного білінгу (ніколи
     * не підписувався). Підписочні поля null, card не зберігаємо (one-off не
     * лишає recToken). Лише рівень доступу + дата закінчення.
     */
    private freshOneOffBilling(
        level: AccessLevel,
        accessUntil: Date,
        currency: string,
        oneOffOrderReference: string
    ): NonNullable<UserDocument['billing']> {
        return {
            provider: PROVIDER,
            orderReference: null,
            recToken: null,
            cardMask: null,
            planCode: null,
            currency,
            subscriptionStatus: null,
            providerSubscriptionStatus: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            hasActiveSubscription: false,
            lastProviderEventAt: null,
            scheduledPlanCode: null,
            scheduledChangeDate: null,
            rebindPendingAt: null,
            oneOffLevel: level,
            oneOffAccessUntil: accessUntil,
            oneOffOrderReference,
            reconcileRequiredAt: null,
        };
    }

    private planInterval(planCode: string | null): BillingInterval {
        return findSubscriptionPlan(planCode ?? '')?.interval ?? 'month';
    }

    private planLabel(code: string): string {
        return `Підписка ${findSubscriptionPlan(code)?.name ?? code}`;
    }

    private oneOffLabel(code: string): string {
        return findOneOffAccess(code)?.name ?? code;
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

/**
 * Календарний зсув на N місяців із клемпінгом дня до останнього дня цільового
 * місяця: 31 січня + 1 міс = 28/29 лютого, НЕ 3 березня. Голий `setMonth`
 * переливає неіснуючий день у наступний місяць, через що periodEnd /
 * oneOffAccessUntil на списаннях 29-31 числа дрейфували б до 3 днів від
 * реального графіка провайдера, а `remainingRatio` рахував би довжину періоду
 * по зсунутих межах (завищений refund/proration).
 */
function addMonths(date: Date, months: number): Date {
    const next = new Date(date);
    const day = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + months);
    const lastDay = new Date(
        next.getFullYear(),
        next.getMonth() + 1,
        0
    ).getDate();
    next.setDate(Math.min(day, lastDay));
    return next;
}

/**
 * Дата закінчення активного one-off доступу (у майбутньому відносно `now`), або
 * null. Використовується для відкладеного старту підписки поверх one-off.
 */
function activeOneOffUntil(
    billing: UserDocument['billing'],
    now: Date
): Date | null {
    const until = billing?.oneOffAccessUntil ?? null;
    if (until && until.getTime() > now.getTime()) return until;
    return null;
}

function addInterval(date: Date, interval: BillingInterval): Date {
    // 12 місяців замість setFullYear: успадковує клемпінг (29 лютого + рік =
    // 28 лютого, не 1 березня).
    return addMonths(date, interval === 'year' ? 12 : 1);
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

// Максимально можлива довжина інтервалу в днях. Місяць ≤ 31 дня, рік ≤ 366
// (високосний). Використовується як консервативна нижня межа refund-вікна.
const MAX_INTERVAL_DAYS: Record<BillingInterval, number> = {
    month: 31,
    year: 366,
};

/**
 * Найраніша межа списань поточного періоду: `periodEnd` мінус максимально
 * можлива довжина інтервалу В ДНЯХ. День-орієнтований відлік (а не календарний
 * `setMonth(-1)`) критичний: календарне віднімання місяця на кінцях місяця
 * (31 травня → клемпінг) зсуває межу ВПЕРЕД за реальну дату списання і виключає
 * легітимне списання поточного періоду з refund-вікна. Денна межа гарантовано
 * не пізніша за реальне списання; запас у кілька днів нешкідливий — попереднє
 * списання щонайменше на повний інтервал старіше і у вікно не потрапляє.
 */
function periodLookbackStart(periodEnd: Date, interval: BillingInterval): Date {
    const d = new Date(periodEnd);
    d.setDate(d.getDate() - MAX_INTERVAL_DAYS[interval]);
    return d;
}

// Зворотний зсув для `remainingRatio` — той самий клемпінг. Для клемпнутого
// periodEnd (28 лютого від списання 31 січня) відновлений старт наближений
// (28 січня): без збереженого periodStart точніше не відновити. Похибка ≤3 днів
// ЗБІЛЬШУЄ знаменник, тож refund консервативно занижується, не завищується.
function subMonths(date: Date): Date {
    return addMonths(date, -1);
}

function subYears(date: Date): Date {
    return addMonths(date, -12);
}
