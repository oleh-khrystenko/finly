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
    MONOBANK_INVOICE_STATUS,
    MONOBANK_NON_TERMINAL_STATUSES,
    PAYMENT_RECORD_STATUS,
    PAYMENT_RECORD_TYPE,
    PAYMENT_TYPE,
    RESPONSE_CODE,
    SUBSCRIPTION_STATUS,
    type AccessLevel,
    type BillingInterval,
    type BillingWebhookEvent,
    type CreateCheckoutSession,
    type PaymentRecordType,
    type ResumeSubscription,
    type SubscriptionPlanItem,
} from '@finly/types';
import { ENV } from '../../config/env';
import {
    ChargeResult,
    IPaymentProvider,
    PAYMENT_PROVIDER,
    ProviderRequestError,
} from './interfaces/payment-provider.interface';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
    ProcessedWebhookEvent,
    ProcessedWebhookEventDocument,
} from './schemas/processed-webhook-event.schema';
import {
    PaymentRecord,
    PaymentRecordDocument,
    PaymentRecordLean,
} from './schemas/payment-record.schema';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { CatalogService } from './catalog.service';
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
    buildRenewalOrderReference,
    buildSubscriptionOrderReference,
    parseOrderReference,
    type ParsedOrderReference,
} from './order-reference';

const WEBHOOK_MONGO_TIMEOUT_MS = 10_000;
const PROVIDER = 'monobank';

/**
 * На час дії «оплатити зараз» (resume) dunning-годинник мусить мовчати про цього
 * користувача, поки він на хостованій сторінці monobank. Інакше `retryDunning`
 * на черговому проході спише СТАРИЙ токен паралельно з оплатою на новій картці і
 * дасть друге списання за період: resume-checkout має власний (nonce) reference,
 * а dunning — детермінований за межею періоду, тож claim-first їх не дедуплікує.
 * Відсуваємо `nextRetryAt` на це вікно — воно з запасом покриває реальний час
 * уведення картки. Success-вебхук resume скине його раніше (повернувши ACTIVE);
 * кинутий checkout само-лікується — по спливу годинник продовжить добивати
 * прострочку з того самого лічильника спроб (грейс лише трохи довший).
 */
const RESUME_DUNNING_HOLD_MS = 30 * 60 * 1000;

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

        @InjectModel(PaymentRecord.name)
        private readonly paymentRecordModel: Model<PaymentRecordDocument>,

        @InjectConnection()
        private readonly connection: Connection,

        private readonly usersService: UsersService,

        private readonly emailService: EmailService,

        private readonly catalog: CatalogService,

        private readonly reconciliation: ReconciliationService,

        private readonly locks: RedisLockService
    ) {}

    /**
     * Серіалізує білінг-write-операції одного користувача per-user Redis-локом —
     * той самий мьютекс тримають вебхук, billing-clock і реконсиляція. Списання
     * за токеном неідемпотентне на рівні провайдера, тож конкурентні дії
     * користувача (pay-now/cancel) і планувальника не сміють перетинатись. Lock
     * зайнятий → `BILLING_OPERATION_IN_PROGRESS`.
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
            // Guard на нову підписку: будь-який живий слот (ACTIVE, прострочка в
            // межах грейсу, скасування до межі) тримає hasActiveSubscription=true.
            // Відновлення/скасування — окремі дії над наявним слотом, не сюди.
            if (user.billing?.hasActiveSubscription) {
                throw new ConflictException({
                    code: RESPONSE_CODE.ALREADY_SUBSCRIBED,
                    message: 'Already subscribed',
                });
            }
            const plan = this.catalog.getSubscriptionPlan(planCode ?? '');
            if (!plan) {
                throw new BadRequestException({
                    code: RESPONSE_CODE.INVALID_PLAN,
                    message: 'Invalid planCode',
                });
            }

            const orderReference = buildSubscriptionOrderReference(userId);
            const walletId = userId;

            // INCOMPLETE: перше списання підтвердиться вебхуком хостованого
            // checkout-у (там же захоплюється токен). Повна заміна субдока тримає
            // вже сплачений one-off (рівень/дата/слот) і незнятий reconcile-маркер.
            await this.userModel.findByIdAndUpdate(userId, {
                $set: {
                    billing: this.freshSubscriptionBilling({
                        planCode: plan.code,
                        currency: plan.currency,
                        walletId,
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
                    walletId,
                    planName: this.planLabel(plan.code),
                    amount: plan.priceAmount,
                    currency: plan.currency,
                    serviceUrl,
                    returnUrl,
                });
            return { checkoutUrl: result.checkoutUrl };
        }

        const access = this.catalog.getOneOffAccess(oneOffCode ?? '');
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

    // ── Resume (pay-now during grace) ────────────────────────────────────

    /**
     * Відновлення під час прострочки: переоформлює хостований checkout підписки
     * (той самий механізм, що при першому оформленні) — гасить борг і захоплює
     * свіжий токен. Дія над наявним слотом, тому guard на нову підписку її не
     * стосується. Білінг НЕ скидаємо в INCOMPLETE: підписка лишається живою до
     * межі грейсу; success-вебхук поверне її в ACTIVE. Кинутий checkout → стан
     * PAST_DUE доживає грейс як і раніше. На час checkout-у відсуваємо
     * `nextRetryAt` (RESUME_DUNNING_HOLD_MS), щоб dunning-годинник не списав
     * старий токен паралельно з оплатою на новій картці.
     */
    async resumeSubscription(
        userId: string,
        dto: ResumeSubscription
    ): Promise<{ checkoutUrl: string }> {
        return this.withBillingLock(userId, () =>
            this.resumeSubscriptionLocked(userId, dto)
        );
    }

    private async resumeSubscriptionLocked(
        userId: string,
        dto: ResumeSubscription
    ): Promise<{ checkoutUrl: string }> {
        const user = await this.userModel.findById(userId).lean();
        const billing = user?.billing;
        if (
            !billing ||
            !billing.hasActiveSubscription ||
            billing.subscriptionStatus !== SUBSCRIPTION_STATUS.PAST_DUE
        ) {
            throw new BadRequestException({
                code: RESPONSE_CODE.SUBSCRIPTION_NOT_PAST_DUE,
                message: 'Subscription is not past due',
            });
        }
        const plan = this.catalog.getSubscriptionPlan(billing.planCode ?? '');
        if (!plan) {
            throw new BadRequestException({
                code: RESPONSE_CODE.INVALID_PLAN,
                message: 'Invalid planCode',
            });
        }

        // Перш ніж відкривати новий хостований checkout — звести будь-яку
        // незакриту спробу продовження billing-clock-а. Нетермінальний результат
        // списання лишає PENDING-claim з invoiceId; якщо паралельно оплатити на
        // новій картці, обидва можуть осісти success → подвійне списання за
        // період (advanceRenewedPeriod захищає лише СТАН, не гроші). Тому спершу
        // доводимо спробу запитом статусу, і лише на чистому фіналі пускаємо
        // resume. Робиться під тим самим per-user локом, тож гонки немає.
        const inflight = await this.paymentRecordModel
            .findOne({
                userId: new Types.ObjectId(userId),
                type: PAYMENT_RECORD_TYPE.SUBSCRIPTION,
                status: PAYMENT_RECORD_STATUS.PENDING,
            })
            .lean();
        if (inflight) {
            await this.reconcileClaimedRenewal(
                userId,
                inflight.orderReference,
                plan
            );
            const refreshed = await this.userModel.findById(userId).lean();
            if (
                refreshed?.billing?.subscriptionStatus !==
                SUBSCRIPTION_STATUS.PAST_DUE
            ) {
                // Спроба осіла успіхом (підписка вже ACTIVE) або вичерпала грейс
                // (UNPAID) — гасити борг немає чого / нема як.
                throw new BadRequestException({
                    code: RESPONSE_CODE.SUBSCRIPTION_NOT_PAST_DUE,
                    message: 'Subscription is not past due',
                });
            }
            const stillPending = await this.paymentRecordModel.exists({
                userId: new Types.ObjectId(userId),
                type: PAYMENT_RECORD_TYPE.SUBSCRIPTION,
                status: PAYMENT_RECORD_STATUS.PENDING,
            });
            if (stillPending) {
                // Спроба ще не дійшла термінального статусу — не ризикуємо
                // паралельним списанням, просимо зачекати і повторити.
                throw new ConflictException({
                    code: RESPONSE_CODE.BILLING_OPERATION_IN_PROGRESS,
                    message: 'Billing operation already in progress',
                });
            }
        }

        const orderReference = buildSubscriptionOrderReference(userId);
        const result = await this.paymentProvider.createSubscriptionCheckout({
            userId,
            userEmail: user.email,
            orderReference,
            walletId: billing.walletId ?? userId,
            planName: this.planLabel(plan.code),
            amount: plan.priceAmount,
            currency: plan.currency,
            serviceUrl: this.serviceUrl(),
            returnUrl: this.returnUrl(dto.returnPath),
        });

        // Роззброюємо dunning-годинник на час хостованого checkout-у: поки
        // користувач уводить картку, `retryDunning` не сміє списати старий токен
        // (друге списання за період). Беремо максимум із наявним `nextRetryAt`,
        // щоб НЕ наблизити повтор, якщо він і так далі за вікно. Робиться під
        // тим самим per-user локом, тож гонки з планувальником немає.
        const holdUntilMs = Date.now() + RESUME_DUNNING_HOLD_MS;
        const existingRetryMs = billing.nextRetryAt
            ? new Date(billing.nextRetryAt).getTime()
            : 0;
        await this.userModel.findByIdAndUpdate(userId, {
            $set: {
                'billing.nextRetryAt': new Date(
                    Math.max(holdUntilMs, existingRetryMs)
                ),
            },
        });

        return { checkoutUrl: result.checkoutUrl };
    }

    // ── Cancel (end of period only) ──────────────────────────────────────

    async cancelSubscription(userId: string): Promise<void> {
        return this.withBillingLock(userId, () =>
            this.cancelSubscriptionLocked(userId)
        );
    }

    private async cancelSubscriptionLocked(userId: string): Promise<void> {
        const user = await this.userModel.findById(userId).lean();
        if (!user?.billing?.hasActiveSubscription) {
            throw new BadRequestException({
                code: RESPONSE_CODE.NO_ACTIVE_SUBSCRIPTION,
                message: 'No active subscription',
            });
        }
        // Кінець періоду: припиняємо планувати списання (nextChargeAt/nextRetryAt
        // null → billing-clock підписку не чіпає), доступ лишається до межі
        // оплаченого періоду, токен видаляємо. Межу гасить daily-sweep
        // (`expireCanceledSubscriptions`).
        await this.userModel.findByIdAndUpdate(userId, {
            $set: {
                'billing.cancelAtPeriodEnd': true,
                'billing.nextChargeAt': null,
                'billing.nextRetryAt': null,
                'billing.cardToken': null,
            },
        });
    }

    // ── Payment history ──────────────────────────────────────────────────

    async listPayments(
        userId: string,
        limit: number
    ): Promise<PaymentRecordLean[]> {
        return this.paymentRecordModel
            .find({
                userId: new Types.ObjectId(userId),
                // PENDING claim-first записи — внутрішні; у кабінеті не показуємо.
                status: { $ne: PAYMENT_RECORD_STATUS.PENDING },
            })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
    }

    // ── Billing clock: charge / dunning / reconcile ──────────────────────

    /**
     * Списує продовження підписки за збереженим токеном. Викликається
     * billing-clock-ом для ACTIVE-підписок з насталою `nextChargeAt` і для
     * PAST_DUE з насталою `nextRetryAt` (логіка спільна — обидві списують межу
     * `currentPeriodEnd`). Claim-first + per-user лок гарантують одне списання
     * на період попри повторний/пропущений запуск.
     */
    async chargeDueSubscription(userId: string): Promise<void> {
        await this.withBillingLock(userId, () =>
            this.chargeDueSubscriptionLocked(userId)
        );
    }

    private async chargeDueSubscriptionLocked(userId: string): Promise<void> {
        const user = await this.userModel.findById(userId).lean();
        const b = user?.billing;
        if (
            !b ||
            !b.hasActiveSubscription ||
            b.cancelAtPeriodEnd ||
            !b.cardToken ||
            !b.planCode ||
            !b.currentPeriodEnd ||
            (b.subscriptionStatus !== SUBSCRIPTION_STATUS.ACTIVE &&
                b.subscriptionStatus !== SUBSCRIPTION_STATUS.PAST_DUE)
        ) {
            return;
        }
        const plan = this.catalog.getSubscriptionPlan(b.planCode);
        if (!plan) {
            this.logger.error(
                `Cannot charge user ${userId}: unknown planCode ${b.planCode}`
            );
            return;
        }

        const boundary = b.currentPeriodEnd;
        const orderReference = buildRenewalOrderReference(userId, boundary);
        const currency = b.currency ?? BILLING_CURRENCY;

        const claim = await this.claimRenewalAttempt(
            userId,
            orderReference,
            plan.priceAmount,
            currency
        );
        if (claim === 'exists') {
            // Спроба для цього періоду вже зафіксована (повторний прохід після
            // краху / нетермінальний результат): не списуємо вдруге, звіряємо.
            await this.reconcileClaimedRenewal(userId, orderReference, plan);
            return;
        }

        let result: ChargeResult;
        try {
            result = await this.paymentProvider.chargeByToken({
                orderReference,
                cardToken: b.cardToken,
                amount: plan.priceAmount,
                currency,
                productName: this.planLabel(plan.code),
                serviceUrl: this.serviceUrl(),
            });
        } catch (error) {
            if (
                error instanceof ProviderRequestError &&
                error.chargeDefinitelyNotApplied
            ) {
                // Провайдер відхилив запит ДО списання (HTTP 4xx, напр.
                // rate-limit): гроші не рухались. Знімаємо claim, щоб наступний
                // прохід billing-clock переспробував із тим самим детермінованим
                // reference. Розклад і доступ НЕ чіпаємо — без manual-review-
                // вклинення і безстрокового безкоштовного доступу на транзитній
                // відмові.
                this.logger.warn(
                    `chargeByToken rejected without debit for ${orderReference}, ` +
                        `releasing claim for retry next pass: ` +
                        (error instanceof Error ? error.message : String(error))
                );
                await this.releaseRenewalClaim(orderReference);
                return;
            }
            // Результат списання НЕВІДОМИЙ (таймаут / мережа / 5xx): гроші могли
            // рухатись, тож НЕ списуємо повторно. claim-запис лишається PENDING
            // без invoiceId — доказ спроби. Зупиняємо планувальник для цього
            // користувача (`nextChargeAt=null` → випадає з due-вибірки, без
            // щогодинного re-pick і лог-спаму) і ставимо durable-прапор
            // `needsManualReview` для ops. Доступ зберігаємо (клієнт міг сплатити).
            this.logger.error(
                `chargeByToken transport failure for ${orderReference} ` +
                    `(result unknown), flagged needsManualReview`,
                error instanceof Error ? error.stack : String(error)
            );
            await this.flagManualReview(userId);
            return;
        }

        await this.applyRenewalChargeResult(
            userId,
            orderReference,
            result,
            plan,
            boundary,
            currency,
            user.email
        );
    }

    /**
     * Звірка вже зафіксованої спроби продовження через запит статусу рахунку.
     * Викликається на повторному проході (claim існує) і billing-clock-reconcile
     * для завислих PENDING-записів. Без invoiceId результат нерозвʼязний — ручний
     * розбір (повторно не списуємо: гроші могли рухатись).
     */
    private async reconcileClaimedRenewal(
        userId: string,
        orderReference: string,
        plan: SubscriptionPlanItem
    ): Promise<void> {
        const record = await this.paymentRecordModel
            .findOne({
                orderReference,
                status: PAYMENT_RECORD_STATUS.PENDING,
            })
            .lean();
        if (!record) return; // вже фіналізовано

        const user = await this.userModel.findById(userId).lean();
        const b = user?.billing;
        if (!b) return;
        const currency = b.currency ?? BILLING_CURRENCY;
        // Межу беремо з самого reference (детермінований epoch), не з поточного
        // currentPeriodEnd: якщо період уже просунули, поточне значення інше, а
        // advanceRenewedPeriod має звіряти саме оригінальну межу (ідемпотентність).
        const boundary = renewalBoundaryFromRef(orderReference);
        if (!boundary) return;

        if (!record.providerTransactionId) {
            this.logger.error(
                `Renewal ${orderReference} stuck without invoiceId — ` +
                    `flagged needsManualReview (charge result unknown, not retried)`
            );
            await this.flagManualReview(userId);
            return;
        }

        let event: BillingWebhookEvent | null;
        try {
            event = await this.paymentProvider.getInvoiceStatus(
                record.providerTransactionId,
                orderReference
            );
        } catch (error) {
            this.logger.warn(
                `getInvoiceStatus failed for ${orderReference}, will retry next pass: ` +
                    (error instanceof Error ? error.message : String(error))
            );
            return;
        }
        if (!event) return;

        await this.finalizeRenewalTerminal(userId, orderReference, boundary, {
            plan,
            currency,
            email: user.email,
            status: event.status,
            invoiceId: event.invoiceId,
            cardMask: event.cardMask,
            cardToken: event.cardToken,
        });
    }

    private async applyRenewalChargeResult(
        userId: string,
        orderReference: string,
        result: ChargeResult,
        plan: SubscriptionPlanItem,
        boundary: Date,
        currency: string,
        email: string
    ): Promise<void> {
        // Записуємо invoiceId у claim ОДРАЗУ — без нього наступний прохід не
        // зможе звірити статус і впав би у ручний розбір.
        await this.paymentRecordModel.updateOne(
            { orderReference, status: PAYMENT_RECORD_STATUS.PENDING },
            { $set: { providerTransactionId: result.invoiceId } }
        );

        if (this.isNonTerminal(result.status)) {
            // Списання асинхронне: лишаємо PENDING з invoiceId, billing-clock
            // reconcile доведе до фіналу запитом статусу.
            return;
        }
        await this.finalizeRenewalTerminal(userId, orderReference, boundary, {
            plan,
            currency,
            email,
            status: result.status,
            invoiceId: result.invoiceId,
            cardMask: result.cardMask,
            cardToken: result.cardToken,
        });
    }

    /**
     * Фіналізує термінальний результат продовження. Перехід claim-запису
     * PENDING→термінал і відповідна мутація білінгу робляться в ОДНІЙ транзакції,
     * тож стану «запис APPROVED, але період не просунуто» не існує — інакше
     * наступний прохід clock-а створив би новий claim (partial-unique звільнено)
     * і списав би вдруге. Side-effects (лист, реконсиляція) — ПІСЛЯ commit-у,
     * гейтовані на те, що саме цей виклик здійснив перехід (без подвійних листів /
     * подвійного інкременту dunning на повторній звірці).
     */
    private async finalizeRenewalTerminal(
        userId: string,
        orderReference: string,
        boundary: Date,
        ctx: {
            plan: SubscriptionPlanItem;
            currency: string;
            email: string;
            status: string;
            invoiceId: string;
            cardMask: string | null;
            cardToken: string | null;
        }
    ): Promise<void> {
        if (this.isNonTerminal(ctx.status)) return;

        if (ctx.status === MONOBANK_INVOICE_STATUS.SUCCESS) {
            const applied = await this.commitRenewalSuccess(
                userId,
                orderReference,
                boundary,
                ctx.plan.interval,
                ctx.invoiceId,
                ctx.cardMask,
                ctx.cardToken
            );
            if (applied) {
                this.logger.log(
                    `Subscription renewed for user ${userId} (plan ${ctx.plan.code})`
                );
            }
            return;
        }

        const dunning = await this.commitRenewalDecline(
            userId,
            orderReference,
            ctx.invoiceId,
            ctx.cardMask
        );
        if (!dunning) return; // перехід уже зроблено раніше — без дублю side-effects

        this.logger.warn(
            `Renewal charge declined for user ${userId} (plan ${ctx.plan.code}, ` +
                `attempt ${dunning.attempts}/${ENV.BILLING_DUNNING_MAX_ATTEMPTS})`
        );
        if (dunning.exhausted) {
            await this.reconcileSafe(userId);
            await this.sendBillingEmailSafe(() =>
                this.emailService.sendSubscriptionEnded({
                    email: ctx.email,
                    planName: this.planLabel(ctx.plan.code),
                })
            );
        } else {
            await this.sendBillingEmailSafe(() =>
                this.emailService.sendSubscriptionPastDue({
                    email: ctx.email,
                    planName: this.planLabel(ctx.plan.code),
                    amount: ctx.plan.priceAmount,
                    currency: ctx.currency,
                    attempt: dunning.attempts,
                    maxAttempts: ENV.BILLING_DUNNING_MAX_ATTEMPTS,
                })
            );
        }
    }

    /**
     * Атомарно: claim PENDING→APPROVED + просування періоду. Повертає true, лише
     * якщо саме цей виклик здійснив перехід (matched). Повторна звірка вже
     * термінального запису → matched=false → no-op (без подвійного просування).
     */
    private async commitRenewalSuccess(
        userId: string,
        orderReference: string,
        boundary: Date,
        interval: BillingInterval,
        invoiceId: string,
        cardMask: string | null,
        cardToken: string | null
    ): Promise<boolean> {
        const session = await this.connection.startSession();
        try {
            let applied = false;
            await session.withTransaction(async () => {
                const matched = await this.settlePaymentRecord(
                    orderReference,
                    PAYMENT_RECORD_STATUS.APPROVED,
                    invoiceId,
                    cardMask,
                    session
                );
                if (!matched) {
                    applied = false;
                    return;
                }
                await this.advanceRenewedPeriod(
                    userId,
                    boundary,
                    interval,
                    cardMask,
                    cardToken,
                    session
                );
                applied = true;
            });
            return applied;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Атомарно: claim PENDING→DECLINED + крок dunning (PAST_DUE або UNPAID).
     * Повертає підсумок лише якщо саме цей виклик здійснив перехід — інакше null
     * (без подвійного інкременту лічильника спроб і повторного листа на звірці).
     */
    private async commitRenewalDecline(
        userId: string,
        orderReference: string,
        invoiceId: string,
        cardMask: string | null
    ): Promise<{ exhausted: boolean; attempts: number } | null> {
        const session = await this.connection.startSession();
        try {
            let outcome: { exhausted: boolean; attempts: number } | null = null;
            await session.withTransaction(async () => {
                const matched = await this.settlePaymentRecord(
                    orderReference,
                    PAYMENT_RECORD_STATUS.DECLINED,
                    invoiceId,
                    cardMask,
                    session
                );
                if (!matched) {
                    outcome = null;
                    return;
                }
                const user = await this.userModel
                    .findById(userId)
                    .session(session)
                    .lean();
                const attempts = (user?.billing?.dunningAttempts ?? 0) + 1;
                const exhausted = attempts >= ENV.BILLING_DUNNING_MAX_ATTEMPTS;
                if (exhausted) {
                    await this.userModel.updateOne(
                        { _id: userId },
                        {
                            $set: {
                                'billing.subscriptionStatus':
                                    SUBSCRIPTION_STATUS.UNPAID,
                                'billing.hasActiveSubscription': false,
                                'billing.dunningAttempts': attempts,
                                'billing.nextChargeAt': null,
                                'billing.nextRetryAt': null,
                                'billing.cardToken': null,
                            },
                        },
                        { session }
                    );
                } else {
                    const nextRetryAt = new Date(
                        Date.now() +
                            ENV.BILLING_DUNNING_RETRY_INTERVAL_HOURS * 3_600_000
                    );
                    await this.userModel.updateOne(
                        { _id: userId },
                        {
                            $set: {
                                'billing.subscriptionStatus':
                                    SUBSCRIPTION_STATUS.PAST_DUE,
                                'billing.hasActiveSubscription': true,
                                'billing.dunningAttempts': attempts,
                                'billing.nextChargeAt': null,
                                'billing.nextRetryAt': nextRetryAt,
                            },
                        },
                        { session }
                    );
                }
                outcome = { exhausted, attempts };
            });
            return outcome;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Просуває межу періоду на один інтервал ВІД попередньої межі (не від now) —
     * без дрейфу графіка. Скидає стан dunning, прапор ручного розбору і виставляє
     * наступне списання. Фільтр на `currentPeriodEnd === boundary` робить
     * просування ідемпотентним у межах транзакції з settle.
     */
    private async advanceRenewedPeriod(
        userId: string,
        boundary: Date,
        interval: BillingInterval,
        cardMask: string | null,
        cardToken: string | null,
        session: ClientSession
    ): Promise<void> {
        const newPeriodEnd = addInterval(boundary, interval);
        const set: Record<string, unknown> = {
            'billing.subscriptionStatus': SUBSCRIPTION_STATUS.ACTIVE,
            'billing.hasActiveSubscription': true,
            'billing.currentPeriodEnd': newPeriodEnd,
            'billing.nextChargeAt': newPeriodEnd,
            'billing.dunningAttempts': 0,
            'billing.nextRetryAt': null,
            'billing.needsManualReview': false,
            'billing.lastProviderEventAt': new Date(),
        };
        if (cardMask) set['billing.cardMask'] = cardMask;
        if (cardToken) set['billing.cardToken'] = cardToken;
        await this.userModel.updateOne(
            { _id: userId, 'billing.currentPeriodEnd': boundary },
            { $set: set },
            { session }
        );
    }

    /**
     * Durable-прапор «потребує ручного розбору» + зупинка планувальника
     * (`nextChargeAt=null`) для нерозвʼязних випадків (невідомий результат
     * списання). ops знаходить таких через `billing.needsManualReview`. Доступ не
     * чіпаємо — клієнт міг сплатити.
     */
    private async flagManualReview(userId: string): Promise<void> {
        await this.userModel.updateOne(
            { _id: userId },
            {
                $set: {
                    'billing.needsManualReview': true,
                    'billing.nextChargeAt': null,
                },
            }
        );
    }

    /**
     * billing-clock reconcile: доводить до фіналу PENDING claim-записи з
     * invoiceId (нетермінальний результат списання або крах після списання).
     */
    async finalizePendingRenewal(
        userId: string,
        orderReference: string
    ): Promise<void> {
        await this.withBillingLock(userId, async () => {
            const user = await this.userModel.findById(userId).lean();
            const b = user?.billing;
            if (!b || !b.planCode) return;
            const plan = this.catalog.getSubscriptionPlan(b.planCode);
            if (!plan) return;
            await this.reconcileClaimedRenewal(userId, orderReference, plan);
        });
    }

    private async claimRenewalAttempt(
        userId: string,
        orderReference: string,
        amount: number,
        currency: string
    ): Promise<'claimed' | 'exists'> {
        try {
            await this.paymentRecordModel.create({
                userId: new Types.ObjectId(userId),
                orderReference,
                type: PAYMENT_RECORD_TYPE.SUBSCRIPTION,
                amount,
                currency,
                status: PAYMENT_RECORD_STATUS.PENDING,
                providerTransactionId: null,
                cardMask: null,
                refundAmount: null,
            });
            return 'claimed';
        } catch (error) {
            if (isDuplicateKeyError(error)) return 'exists';
            throw error;
        }
    }

    /**
     * Знімає невикористаний claim-запис спроби продовження (PENDING без
     * invoiceId). Викликається коли провайдер ВІДХИЛИВ списання до дебету (HTTP
     * 4xx) — гроші не рухались, тож спробу слід просто повторити наступним
     * проходом. Фільтр `providerTransactionId: null` гарантує, що ми не видалимо
     * запис, для якого вже отримано invoiceId (там результат міг застосуватись).
     */
    private async releaseRenewalClaim(orderReference: string): Promise<void> {
        await this.paymentRecordModel.deleteOne({
            orderReference,
            status: PAYMENT_RECORD_STATUS.PENDING,
            providerTransactionId: null,
        });
    }

    /**
     * Переводить claim-запис PENDING→термінал. Повертає true, лише якщо саме цей
     * виклик здійснив перехід (matched одного PENDING). Це гейт ідемпотентності:
     * паралельний/повторний фіналізатор побачить modifiedCount=0 і не застосує
     * side-effects удруге.
     */
    private async settlePaymentRecord(
        orderReference: string,
        status:
            | typeof PAYMENT_RECORD_STATUS.APPROVED
            | typeof PAYMENT_RECORD_STATUS.DECLINED,
        invoiceId: string,
        cardMask: string | null,
        session: ClientSession
    ): Promise<boolean> {
        const set: Record<string, unknown> = {
            status,
            providerTransactionId: invoiceId,
        };
        if (cardMask) set.cardMask = cardMask;
        const res = await this.paymentRecordModel.updateOne(
            { orderReference, status: PAYMENT_RECORD_STATUS.PENDING },
            { $set: set },
            { session }
        );
        return res.modifiedCount === 1;
    }

    // ── Webhook ──────────────────────────────────────────────────────────

    /**
     * Повертає true, якщо подію оброблено/визнано (контролер віддає 200). false →
     * подію слід передоставити (lock-busy або crash-orphan) — контролер віддає
     * non-2xx, monobank повторить.
     */
    async handleWebhook(
        rawBody: Buffer,
        signature: string | undefined
    ): Promise<boolean> {
        const { event } = await this.paymentProvider.parseWebhook(
            rawBody,
            signature
        );
        if (!event) {
            // Невалідний підпис / нерозбірне тіло: 200 без обробки (не зливаємо
            // причину, не провокуємо нескінченні повтори).
            return true;
        }

        const parsed = parseOrderReference(event.orderReference);
        if (!parsed) {
            this.logger.debug(
                `Unrecognized reference ${event.orderReference}, acked without routing`
            );
            return true;
        }

        try {
            return await this.withBillingLock(parsed.userId, () =>
                this.routeTransaction(event, parsed)
            );
        } catch (error) {
            if (isBillingLockBusy(error)) {
                this.logger.debug(
                    `Webhook ${event.providerEventId} deferred: lock busy for ${parsed.userId}`
                );
                return false;
            }
            this.logger.error(
                `Failed to process webhook ${event.providerEventId}`,
                error instanceof Error ? error.stack : String(error)
            );
            return false;
        }
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
            await this.backfillMissingCardToken(event, parsed);
            return true;
        }
        if (insert === 'pending') {
            this.logger.warn(
                `Webhook ${event.providerEventId} is a pending crash-orphan, not acked`
            );
            return false;
        }

        await this.applyInWebhookTx(event, async (session) => {
            if (parsed.kind === ORDER_KIND.ONE_OFF) {
                await this.applyOneOffTransaction(
                    event,
                    parsed.oneOffCode,
                    userId,
                    session
                );
            } else {
                await this.applySubscriptionTransaction(event, userId, session);
            }
        });
        // Доступ міг піднятись (активація / грант one-off) — знімаємо блокування.
        await this.reconcileSafe(userId);
        return true;
    }

    /**
     * monobank шле кілька success-вебхуків на одну оплату: перший без
     * `walletData` (токен картки ще не випущено), наступний — уже з ним. Усі
     * мають однаковий `providerEventId` (`invoiceId:success`), тож дедуп
     * відкидає пізніший як дубль — разом із `cardToken`, який лише в ньому.
     * Без токена продовження неможливе (`chargeDueSubscription` мовчки виходить
     * на guard `!cardToken`). Тож на дубль-події дозбираємо саме відсутній
     * токен: вузький idempotent-патч (фільтр `cardToken: null` не перезапише
     * наявний і не подвоїть оплату), без руху `lastProviderEventAt` — токен
     * картки не stateful, він той самий незалежно від порядку доставки.
     */
    private async backfillMissingCardToken(
        event: BillingWebhookEvent,
        parsed: ParsedOrderReference
    ): Promise<void> {
        if (parsed.kind === ORDER_KIND.ONE_OFF) return;
        if (!event.cardToken) return;
        try {
            const res = await this.userModel.updateOne(
                {
                    _id: parsed.userId,
                    billing: { $ne: null },
                    'billing.cardToken': null,
                },
                { $set: { 'billing.cardToken': event.cardToken } }
            );
            if (res.modifiedCount > 0) {
                this.logger.log(
                    `Backfilled card token for user ${parsed.userId} from ` +
                        `duplicate event ${event.providerEventId}`
                );
            }
        } catch (error) {
            this.logger.error(
                `Failed to backfill card token for user ${parsed.userId} ` +
                    `(${event.providerEventId})`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    /**
     * Side-effects події + перехід webhook-події pending→applied в одній
     * транзакції. Частковий збій відкочує все, лишає подію pending, catch її
     * видаляє → monobank передоставить і переобробить з нуля.
     */
    private async applyInWebhookTx(
        event: BillingWebhookEvent,
        work: (session: ClientSession) => Promise<void>
    ): Promise<void> {
        const session = await this.connection.startSession();
        try {
            await session.withTransaction(async () => {
                await work(session);
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

    private async applyOneOffTransaction(
        event: BillingWebhookEvent,
        oneOffCode: string,
        userId: string,
        session: ClientSession
    ): Promise<void> {
        if (this.isNonTerminal(event.status)) return;
        if (event.status !== MONOBANK_INVOICE_STATUS.SUCCESS) {
            this.logger.warn(
                `One-off charge not successful for user ${userId} ` +
                    `(${event.orderReference}): status=${event.status}`
            );
            await this.recordPayment(
                {
                    userId,
                    orderReference: event.orderReference,
                    type: PAYMENT_RECORD_TYPE.ONE_OFF,
                    amount: event.amount,
                    currency: event.currency,
                    status: PAYMENT_RECORD_STATUS.DECLINED,
                    providerTransactionId: event.invoiceId,
                    cardMask: event.cardMask,
                },
                session
            );
            return;
        }

        const access = this.catalog.getOneOffAccess(oneOffCode);
        if (!access) {
            this.logger.warn(`Unknown oneOffCode ${oneOffCode} in webhook`);
            return;
        }
        // Орендований доступ: свіжий місяць від моменту оплати (перезаписуємо
        // слот). Ідемпотентність — unique-індекс (provider, providerEventId) до
        // транзакції.
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
                providerTransactionId: event.invoiceId,
                cardMask: event.cardMask,
            },
            session
        );
        this.logger.log(
            `One-off ${oneOffCode}: access ${access.level} until ` +
                `${accessUntil.toISOString()} for user ${userId}`
        );
    }

    /**
     * Вебхук підписки. Для першого checkout-у / resume — ПЕРВИННИЙ шлях (немає
     * попереднього claim-запису billing-clock): success активує підписку від
     * моменту оплати. Для продовжень — ВТОРИННИЙ: claim-запис уже фіналізований
     * синхронним результатом списання (термінальний record → no-op); лише якщо
     * синхронний результат загубився, вебхук доводить продовження до фіналу від
     * межі періоду.
     */
    private async applySubscriptionTransaction(
        event: BillingWebhookEvent,
        userId: string,
        session: ClientSession
    ): Promise<void> {
        if (this.isNonTerminal(event.status)) return;

        const existing = await this.paymentRecordModel
            .findOne({
                orderReference: event.orderReference,
                providerTransactionId: event.invoiceId,
            })
            .session(session)
            .lean();
        if (existing && existing.status !== PAYMENT_RECORD_STATUS.PENDING) {
            // Уже фіналізовано (синхронним результатом списання) — лише ack.
            return;
        }

        const user = await this.userModel
            .findById(userId)
            .session(session)
            .lean();
        const billing = user?.billing;
        if (!billing) {
            // Підписки немає (скасована/перезаписана), а гроші пройшли → слід на
            // ручний розбір (refund поза нашим кодом).
            if (event.status === MONOBANK_INVOICE_STATUS.SUCCESS) {
                this.logger.error(
                    `Subscription charge on user ${userId} without billing ` +
                        `(${event.orderReference}): manual review required`
                );
                await this.recordPayment(
                    {
                        userId,
                        orderReference: event.orderReference,
                        type: PAYMENT_RECORD_TYPE.UNMATCHED,
                        amount: event.amount,
                        currency: event.currency,
                        status: PAYMENT_RECORD_STATUS.APPROVED,
                        providerTransactionId: event.invoiceId,
                        cardMask: event.cardMask,
                    },
                    session
                );
            }
            return;
        }

        const plan = this.catalog.getSubscriptionPlan(billing.planCode ?? '');
        const interval = plan?.interval ?? 'month';

        if (event.status !== MONOBANK_INVOICE_STATUS.SUCCESS) {
            // Невдала оплата хостованого checkout-у (первинний шлях). Продовження
            // приходять синхронним результатом, тож сюди трапляє лише
            // first-checkout / resume відмова: лишаємо стан як є, фіксуємо слід.
            await this.recordPayment(
                {
                    userId,
                    orderReference: event.orderReference,
                    type: PAYMENT_RECORD_TYPE.SUBSCRIPTION,
                    amount: event.amount,
                    currency: event.currency,
                    status: PAYMENT_RECORD_STATUS.DECLINED,
                    providerTransactionId: event.invoiceId,
                    cardMask: event.cardMask,
                },
                session
            );
            return;
        }

        // Success. Продовження (claim PENDING) → від межі періоду; первинний
        // (first-checkout / resume, без claim) → від моменту оплати.
        const isRenewal = existing?.status === PAYMENT_RECORD_STATUS.PENDING;
        const periodStart =
            isRenewal && billing.currentPeriodEnd
                ? billing.currentPeriodEnd
                : event.occurredAt;
        const periodEnd = addInterval(periodStart, interval);

        const set: Record<string, unknown> = {
            'billing.subscriptionStatus': SUBSCRIPTION_STATUS.ACTIVE,
            'billing.hasActiveSubscription': true,
            'billing.cancelAtPeriodEnd': false,
            'billing.currentPeriodEnd': periodEnd,
            'billing.nextChargeAt': periodEnd,
            'billing.dunningAttempts': 0,
            'billing.nextRetryAt': null,
            'billing.needsManualReview': false,
        };
        if (event.cardToken) set['billing.cardToken'] = event.cardToken;
        if (event.cardMask) set['billing.cardMask'] = event.cardMask;

        const updated = await this.applyBillingUpdate(
            userId,
            event,
            set,
            session
        );
        if (!updated) return;

        if (existing?.status === PAYMENT_RECORD_STATUS.PENDING) {
            await this.paymentRecordModel.updateOne(
                { _id: existing._id },
                {
                    $set: {
                        status: PAYMENT_RECORD_STATUS.APPROVED,
                        providerTransactionId: event.invoiceId,
                        cardMask: event.cardMask ?? existing.cardMask,
                    },
                },
                { session }
            );
        } else {
            await this.recordPayment(
                {
                    userId,
                    orderReference: event.orderReference,
                    type: PAYMENT_RECORD_TYPE.SUBSCRIPTION,
                    amount: event.amount,
                    currency: event.currency,
                    status: PAYMENT_RECORD_STATUS.APPROVED,
                    providerTransactionId: event.invoiceId,
                    cardMask: event.cardMask,
                },
                session
            );
        }
        this.logger.log(
            `Subscription ${isRenewal ? 'renewal' : 'activation'} for user ${userId} ` +
                `(plan ${billing.planCode}, event ${event.providerEventId})`
        );
    }

    /**
     * Atomic billing $set з guard на out-of-order: застосовується лише якщо подія
     * новіша за останню (`lastProviderEventAt < occurredAt`). Повертає true, якщо
     * застосовано.
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
                type: event.status,
                userId,
                oneOffCode,
                status: 'pending',
            });
            return 'new';
        } catch (error: unknown) {
            if (isDuplicateKeyError(error)) {
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

    private isNonTerminal(status: string): boolean {
        return (MONOBANK_NON_TERMINAL_STATUSES as readonly string[]).includes(
            status
        );
    }

    /**
     * Реконсиляція бізнесів під новий рівень доступу — best-effort. Durable-маркер
     * `reconcileRequiredAt` ставиться ДО спроби; daily-sweep добиває стемпнутих.
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

    private async sendBillingEmailSafe(
        send: () => Promise<void>
    ): Promise<void> {
        try {
            await send();
        } catch (error) {
            this.logger.error(
                'Billing email send failed',
                error instanceof Error ? error.stack : String(error)
            );
        }
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

    private freshSubscriptionBilling(partial: {
        planCode: string;
        currency: string;
        walletId: string;
        oneOffLevel: string | null;
        oneOffAccessUntil: Date | null;
        oneOffOrderReference: string | null;
        reconcileRequiredAt: Date | null;
    }): NonNullable<UserDocument['billing']> {
        return {
            provider: PROVIDER,
            cardToken: null,
            walletId: partial.walletId,
            cardMask: null,
            planCode: partial.planCode,
            currency: partial.currency,
            subscriptionStatus: SUBSCRIPTION_STATUS.INCOMPLETE,
            currentPeriodEnd: null,
            nextChargeAt: null,
            cancelAtPeriodEnd: false,
            hasActiveSubscription: false,
            lastProviderEventAt: null,
            dunningAttempts: 0,
            nextRetryAt: null,
            needsManualReview: false,
            oneOffLevel: partial.oneOffLevel,
            oneOffAccessUntil: partial.oneOffAccessUntil,
            oneOffOrderReference: partial.oneOffOrderReference,
            reconcileRequiredAt: partial.reconcileRequiredAt,
        };
    }

    private freshOneOffBilling(
        level: AccessLevel,
        accessUntil: Date,
        currency: string,
        oneOffOrderReference: string
    ): NonNullable<UserDocument['billing']> {
        return {
            provider: PROVIDER,
            cardToken: null,
            walletId: null,
            cardMask: null,
            planCode: null,
            currency,
            subscriptionStatus: null,
            currentPeriodEnd: null,
            nextChargeAt: null,
            cancelAtPeriodEnd: false,
            hasActiveSubscription: false,
            lastProviderEventAt: null,
            dunningAttempts: 0,
            nextRetryAt: null,
            needsManualReview: false,
            oneOffLevel: level,
            oneOffAccessUntil: accessUntil,
            oneOffOrderReference,
            reconcileRequiredAt: null,
        };
    }

    private planLabel(code: string): string {
        return `Підписка ${this.catalog.getSubscriptionPlan(code)?.name ?? code}`;
    }

    private oneOffLabel(code: string): string {
        return this.catalog.getOneOffAccess(code)?.name ?? code;
    }

    private serviceUrl(): string {
        return `${ENV.WEB_URL}/api/payments/webhook/${PROVIDER}`;
    }

    private returnUrl(returnPath?: string): string {
        const query = returnPath
            ? `?returnPath=${encodeURIComponent(returnPath)}`
            : '';
        // Повернення з хостованої сторінки monobank іде GET-редиректом; ведемо на
        // міст `/billing-return` (route-handler, 303) проти крос-сайтового POST.
        return `${ENV.WEB_URL}/billing-return${query}`;
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

function isBillingLockBusy(error: unknown): boolean {
    return (
        error instanceof ConflictException &&
        (error.getResponse() as { code?: string })?.code ===
            RESPONSE_CODE.BILLING_OPERATION_IN_PROGRESS
    );
}

/**
 * Календарний зсув на N місяців із клемпінгом дня до останнього дня цільового
 * місяця: 31 січня + 1 міс = 28/29 лютого, НЕ 3 березня. Без клемпінгу межі
 * періоду на списаннях 29-31 числа дрейфували б на кілька днів.
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

function addInterval(date: Date, interval: BillingInterval): Date {
    return addMonths(date, interval === 'year' ? 12 : 1);
}

/**
 * Відновлює межу періоду з детермінованого renewal-reference
 * (`fin-sub-<userId>-<epochMs>`). null, якщо суфікс не epoch (checkout-nonce).
 */
function renewalBoundaryFromRef(ref: string): Date | null {
    const parts = ref.split('-');
    if (parts.length !== 4) return null;
    const ms = Number(parts[3]);
    return Number.isFinite(ms) ? new Date(ms) : null;
}
