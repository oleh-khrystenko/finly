import { createHash, randomBytes } from 'crypto';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
    OnModuleInit,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, FilterQuery, Model, Types } from 'mongoose';
import {
    BILLING_CURRENCY,
    BILLING_RETURN_FLOW,
    BILLING_UNIVERSE,
    CARD_VERIFICATION_STATUS,
    type BillingReturnFlow,
    type CardDetails,
    type CardVerificationResult,
    type CardVerificationStatus,
    CREDIT_LEDGER_ENTRY_TYPE,
    MONOBANK_INVOICE_STATUS,
    MONOBANK_NON_TERMINAL_STATUSES,
    PAYMENT_RECORD_STATUS,
    PAYMENT_RECORD_TYPE,
    RESPONSE_CODE,
    SUBSCRIPTION_STATUS,
    brandMonthlyAmount,
    documentsMonthlyAmount,
    documentsMonthlyCredits,
    findDocumentsTierBySize,
    monthlyChargeAmount,
    proratedShare,
    suggestCheaperDocumentsTier,
    BillingProfileViewSchema,
    type BillingGrid,
    type BillingProfileView,
    type BillingUniverse,
    type BillingWebhookEvent,
    type BuyCredits,
    type ChangeCapacity,
    type ManageAttachment,
    type PaymentRecordType,
    type PriceCalculation,
    type PriceCalculatorQuery,
    type StartCardVerification,
    type StartCheckout,
} from '@finly/types';
import { ENV } from '../../config/env';
import {
    BILLING_CARD_RETENTION_DAYS,
    BILLING_CARD_REVOCATION_MAX_FAILURES,
    BILLING_DUNNING,
    BILLING_GRID,
    BILLING_UNIVERSE_ENABLED,
} from '../../config/billing.config';
import {
    ChargeResult,
    IPaymentProvider,
    PAYMENT_PROVIDER,
    ProviderRequestError,
} from './interfaces/payment-provider.interface';
import {
    blankCardFields,
    cardProfileFields,
    cardRecordFields,
} from './card-details';
import {
    BillingProfile,
    BillingProfileDocument,
    BillingProfileLean,
} from './schemas/billing-profile.schema';
import {
    ProcessedWebhookEvent,
    ProcessedWebhookEventDocument,
} from './schemas/processed-webhook-event.schema';
import {
    PaymentRecord,
    PaymentRecordDocument,
    PaymentRecordLean,
} from './schemas/payment-record.schema';
import {
    CreditLedgerEntry,
    CreditLedgerEntryDocument,
    CreditLedgerEntryLean,
} from './schemas/credit-ledger-entry.schema';
import {
    Business,
    BusinessDocument,
} from '../businesses/schemas/business.schema';
import { UsersService } from '../users/users.service';
import {
    EmailService,
    type ManualReviewAlertCharge,
} from '../email/email.service';
import { ReconciliationService } from '../businesses/reconciliation.service';
import {
    BILLING_LOCK_TTL_MS,
    billingLockKey,
} from '../../common/billing/billing-lock';
import {
    RedisLockBusyError,
    RedisLockService,
} from '../../common/services/redis-lock.service';
import { alignToClockTick } from './billing-clock-grid';
import {
    ORDER_KIND,
    buildCardVerifyOrderReference,
    buildCheckoutOrderReference,
    buildReactivationOrderReference,
    buildCreditPackOrderReference,
    buildCycleOrderReference,
    buildProrationOrderReference,
    cycleBoundaryFromRef,
    isCardVerifyKind,
    parseOrderReference,
    type ParsedOrderReference,
} from './order-reference';

const PROVIDER = 'monobank';
const WEBHOOK_MONGO_TIMEOUT_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Наскільки відсувається найближчий повтор списання, поки платник платить зі
 * сторінки банку: інакше клок устиг би списати картку паралельно з ним.
 *
 * Фактичне вікно довше за саме число: повтори бере клок, а він прокидається
 * рівно щогодини, тож холд триває до першого тику після цієї позначки — від
 * 30 до 90 хвилин. Вирівнювати число під сітку не треба, тик однаково
 * забирає все, що вже настало.
 */
const RESUME_DUNNING_HOLD_MS = 30 * 60 * 1000;

/** Скільки останніх нерозпізнаних списань платника показує лист ops. */
const MANUAL_REVIEW_ALERT_UNMATCHED_LIMIT = 5;

/**
 * Склад обох всесвітів: те, з чого рахується місячна сума і що відновлює
 * повернення після вимкнення доступу. Живі поля профілю підходять під цю форму,
 * як і знімок `disabledSnapshot` — тому helper-и приймають саме її.
 */
interface Composition {
    brand: {
        capacity: number;
        pendingCapacity: number | null;
        attachedBusinessIds: Types.ObjectId[];
        pendingKeepBusinessIds: Types.ObjectId[];
    };
    documents: {
        tierSize: number | null;
        pendingTierSize: number | null;
        attachedBusinessIds: Types.ObjectId[];
        pendingKeepBusinessIds: Types.ObjectId[];
    };
}

/**
 * Побічний ефект, що не змінює стан підписки (відкликання картки у банку, лист)
 * і тому виконується вже після звільнення per-user лока: під локом він лише
 * з'їдав би бюджет TTL (див. `billing-lock.ts`).
 */
type AfterLockTask = () => Promise<void>;

/** $set-фрагмент зміни складу разом з бізнесами, що відкріпились. */
interface CompositionUpdates {
    set: Record<string, unknown>;
    detached: string[];
}

/** Відкладений ефект негайного token-списання (пропорція / докупівля). */
interface PendingEffect {
    universe: BillingUniverse;
    targetCapacity: number | null;
    targetTierSize: number | null;
    grantCredits: number;
    /** Бізнес, що атомарно заповнює новий слот на успіху доплати (або null). */
    attachBusinessId: string | null;
}

/**
 * Sprint 27 — серце нового білінгу. Один профіль на платника, два склади, одне
 * місячне списання чистої суми складів. Тримає ту саму money-safety машинерію,
 * що self-managed monobank-білінг: per-user Redis-лок серіалізує всі мутації,
 * claim-first PaymentRecord гарантує одне списання на дію, двофазна
 * ProcessedWebhookEvent-ідемпотентність і out-of-order guard захищають вебхук.
 */
@Injectable()
export class BillingProfileService implements OnModuleInit {
    private readonly logger = new Logger(BillingProfileService.name);
    private readonly grid: BillingGrid = BILLING_GRID;

    constructor(
        @Inject(PAYMENT_PROVIDER)
        private readonly provider: IPaymentProvider,
        @InjectModel(BillingProfile.name)
        private readonly profileModel: Model<BillingProfileDocument>,
        @InjectModel(ProcessedWebhookEvent.name)
        private readonly webhookEventModel: Model<ProcessedWebhookEventDocument>,
        @InjectModel(PaymentRecord.name)
        private readonly paymentRecordModel: Model<PaymentRecordDocument>,
        @InjectModel(CreditLedgerEntry.name)
        private readonly ledgerModel: Model<CreditLedgerEntryDocument>,
        @InjectModel(Business.name)
        private readonly businessModel: Model<BusinessDocument>,
        @InjectConnection()
        private readonly connection: Connection,
        private readonly usersService: UsersService,
        private readonly emailService: EmailService,
        private readonly reconciliation: ReconciliationService,
        private readonly locks: RedisLockService
    ) {}

    /**
     * Fail-fast звірка сітки з живими складами: деплой, що прибирає з
     * `BILLING_GRID.documents.tiers` пакет, на якому сидять оплачені профілі
     * (ACTIVE/PAST_DUE), мусить упасти на старті — інакше view і billing-clock
     * цих платників тихо ламались би на кожному зверненні (unknown tier size).
     * INCOMPLETE/CANCELED/UNPAID не блокують: їх склади перезаписуються новим
     * checkout-ом, а покинутий checkout не має тримати деплой.
     */
    async onModuleInit(): Promise<void> {
        const entitled = {
            status: {
                $in: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.PAST_DUE],
            },
        };
        const [tierSizes, pendingSizes] = await Promise.all([
            this.profileModel.distinct('documents.tierSize', {
                ...entitled,
                'documents.tierSize': { $ne: null },
            }),
            this.profileModel.distinct('documents.pendingTierSize', {
                ...entitled,
                'documents.pendingTierSize': { $gt: 0 },
            }),
        ]);
        const stored = [...tierSizes, ...pendingSizes].filter(
            (size): size is number => typeof size === 'number'
        );
        const missing = [...new Set(stored)].filter(
            (size) => !findDocumentsTierBySize(this.grid.documents, size)
        );
        if (missing.length > 0) {
            throw new Error(
                `❌ BILLING_GRID.documents.tiers has no size(s) [${missing.join(', ')}] ` +
                    'still used by entitled billing profiles — restore the ' +
                    'tier(s) or migrate the profiles before deploying'
            );
        }
    }

    // ── Lock ─────────────────────────────────────────────────────────────

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

    // ── Reads ────────────────────────────────────────────────────────────

    async getProfile(userId: string): Promise<BillingProfileLean | null> {
        return this.profileModel
            .findOne({ userId: new Types.ObjectId(userId) })
            .lean();
    }

    /** Публічний зріз профілю для кабінету (без секретів; з розрахунковою сумою). */
    async getProfileView(userId: string): Promise<BillingProfileView | null> {
        const p = await this.getProfile(userId);
        if (!p) return null;
        // Фільтруємо мертві ref видалених бізнесів для точного відображення
        // (кількість вільних слотів рахується з прикріплень). Read-only: сама
        // чистка у БД відбувається під локом при attach/detach/списанні.
        const alive = await this.existingBusinessIdSet([
            ...p.brand.attachedBusinessIds,
            ...p.documents.attachedBusinessIds,
        ]);
        const live = (ids: Types.ObjectId[]) =>
            ids.map((id) => id.toString()).filter((id) => alive.has(id));
        return BillingProfileViewSchema.parse({
            status: p.status,
            currency: p.currency,
            currentPeriodEnd: p.currentPeriodEnd,
            nextChargeAt: p.nextChargeAt,
            cancelAtPeriodEnd: p.cancelAtPeriodEnd,
            cardMask: p.cardMask,
            cardPaymentMethod: p.cardPaymentMethod ?? null,
            cardPaymentSystem: p.cardPaymentSystem ?? null,
            cardBank: p.cardBank ?? null,
            hasSavedCard: p.cardToken != null,
            accessDisabledByNonPayment: this.isAccessDisabledByNonPayment(p),
            // Скільки з платника візьмуть наступного разу, за ЕФЕКТИВНИМ
            // складом (відкладені зменшення враховано). Для живого доступу це
            // списання на межі циклу; для вимкненого за несплатою профілю зі
            // збереженою карткою — сума повернення, яку кабінет називає на
            // кнопці. Решта станів (покинутий checkout, згаслий профіль) несуть
            // склад, за який ніхто не платитиме, тож нуль.
            nextChargeAmount: this.quotedAmount(p),
            brand: {
                capacity: p.brand.capacity,
                pendingCapacity: p.brand.pendingCapacity,
                attachedBusinessIds: live(p.brand.attachedBusinessIds),
            },
            documents: {
                tierSize: p.documents.tierSize,
                pendingTierSize: p.documents.pendingTierSize,
                attachedBusinessIds: live(p.documents.attachedBusinessIds),
                credits: {
                    balance: p.documents.credits.balance,
                    storageBytesUsed: p.documents.credits.storageBytesUsed,
                },
                // Єдина точка, де клієнт бачить приховані пакети докупівлі
                // (публічний каталог їх навмисно не містить). BuyCredits несе
                // значення пакета звідси і звіряється з сіткою на покупці.
                creditPacks: this.grid.documents.creditPacks,
            },
        });
    }

    /**
     * Сума, яку кабінет має право назвати платнику. Обгорнуто у try/catch, бо
     * склад вимкненого профілю прайситься чинною сіткою без жодних гарантій:
     * fail-fast звірка на старті стереже лише оплачені профілі, тож пакет, що
     * зник із сітки, інакше валив би зріз профілю замість показати нуль.
     */
    private quotedAmount(profile: BillingProfileLean): number {
        // Вимкнений профіль прайситься ЗНІМКОМ складу, а не живими полями: їх
        // міг переписати покинутий checkout, і кабінет назвав би на кнопці
        // повернення суму не того складу, який повернення відновлює.
        const composition = this.isEntitled(profile)
            ? profile
            : this.isAccessDisabledByNonPayment(profile) &&
                profile.cardToken != null
              ? this.disabledComposition(profile)
              : null;
        if (!composition) return 0;
        try {
            return this.effectiveMonthlyAmount(composition);
        } catch {
            return 0;
        }
    }

    /**
     * Склад, за яким рахується і відновлюється повернення після вимкнення
     * доступу: знімок з моменту вимкнення, а НЕ живі поля профілю. Живі поля
     * для вимкненого профілю означають «що платник хоче купити» — `startCheckout`
     * перезаписує їх бажаним складом нової купівлі, і покинута сторінка банку
     * інакше тихо зменшувала б суму повернення і губила оплачені прикріплення.
     *
     * Fallback на живі поля — для профілів, вимкнених до появи знімка: їм
     * лишається та сама поведінка, що була, замість порожнього складу.
     */
    private disabledComposition(profile: BillingProfileLean): Composition {
        return (
            profile.disabledSnapshot ?? {
                brand: profile.brand,
                documents: profile.documents,
            }
        );
    }

    /** Знімок складу для збереження у профілі (без живого кредитного рахунку). */
    private compositionSnapshot(profile: BillingProfileLean): Composition {
        return {
            brand: {
                capacity: profile.brand.capacity,
                pendingCapacity: profile.brand.pendingCapacity,
                attachedBusinessIds: profile.brand.attachedBusinessIds,
                pendingKeepBusinessIds: profile.brand.pendingKeepBusinessIds,
            },
            documents: {
                tierSize: profile.documents.tierSize,
                pendingTierSize: profile.documents.pendingTierSize,
                attachedBusinessIds: profile.documents.attachedBusinessIds,
                pendingKeepBusinessIds:
                    profile.documents.pendingKeepBusinessIds,
            },
        };
    }

    /** Розрахункова місячна сума списання = чиста сума обох складів. */
    monthlyAmount(profile: {
        brand: { capacity: number };
        documents: { tierSize: number | null };
    }): number {
        return monthlyChargeAmount(this.grid, {
            brandCapacity: profile.brand.capacity,
            documentsTierSize: profile.documents.tierSize,
        });
    }

    /**
     * Ефективний склад НАСТУПНОГО циклу: відкладені зменшення вже враховано
     * (`pendingTierSize === 0` — всесвіт вимкнено). Саме за цим складом clock
     * рахує суму списання на межі циклу — зменшення діє з наступного циклу,
     * тож наступний цикл ніколи не списується за старою (більшою) ємністю.
     */
    private effectiveComposition(profile: {
        brand: { capacity: number; pendingCapacity: number | null };
        documents: { tierSize: number | null; pendingTierSize: number | null };
    }): { brandCapacity: number; documentsTierSize: number | null } {
        const brandCapacity =
            profile.brand.pendingCapacity ?? profile.brand.capacity;
        const documentsTierSize =
            profile.documents.pendingTierSize !== null
                ? profile.documents.pendingTierSize === 0
                    ? null
                    : profile.documents.pendingTierSize
                : profile.documents.tierSize;
        return { brandCapacity, documentsTierSize };
    }

    /** Сума наступного місячного списання за ефективним складом. */
    private effectiveMonthlyAmount(profile: {
        brand: { capacity: number; pendingCapacity: number | null };
        documents: { tierSize: number | null; pendingTierSize: number | null };
    }): number {
        return monthlyChargeAmount(
            this.grid,
            this.effectiveComposition(profile)
        );
    }

    async listPayments(
        userId: string,
        limit: number
    ): Promise<PaymentRecordLean[]> {
        return this.paymentRecordModel
            .find({
                userId: new Types.ObjectId(userId),
                status: { $ne: PAYMENT_RECORD_STATUS.PENDING },
            })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
    }

    async listLedger(
        userId: string,
        limit: number
    ): Promise<CreditLedgerEntryLean[]> {
        return this.ledgerModel
            .find({ userId: new Types.ObjectId(userId) })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
    }

    /**
     * Калькулятор для UI: поточне і нове місячне списання, сума негайної доплати
     * (0 при зменшенні) і підказка вигіднішого пакета. Без мутацій і локу.
     */
    async calculate(
        userId: string,
        query: PriceCalculatorQuery
    ): Promise<PriceCalculation> {
        const profile = await this.getProfile(userId);
        const universe = query.universe;
        // Без живого доступу поточний склад = 0: нова купівля стартує з нуля,
        // а stale tierSize згаслого профілю не потрапляє у прайсинг.
        const current =
            profile && this.isEntitled(profile)
                ? this.universeCapacityValue(profile, universe).value
                : 0;
        const target = this.targetCapacityValue(query);
        const currentMonthly = this.universeMonthly(universe, current);
        const newMonthly = this.universeMonthly(universe, target);

        let immediateCharge = 0;
        if (newMonthly > currentMonthly) {
            const delta = newMonthly - currentMonthly;
            if (
                profile &&
                this.isEntitled(profile) &&
                profile.currentPeriodEnd
            ) {
                const { daysRemaining, daysInCycle } = this.cycleWindow(
                    profile,
                    new Date()
                );
                immediateCharge = proratedShare(
                    delta,
                    daysRemaining,
                    daysInCycle
                );
            } else {
                // Перша купівля — повний місяць (хостований checkout).
                immediateCharge = delta;
            }
        }

        const cheaperTierSize =
            universe === BILLING_UNIVERSE.DOCUMENTS && target > 0
                ? (suggestCheaperDocumentsTier(this.grid.documents, target)
                      ?.size ?? null)
                : null;

        return {
            currentMonthlyAmount: currentMonthly,
            newMonthlyAmount: newMonthly,
            immediateCharge,
            cheaperTierSize,
        };
    }

    // ── First purchase: hosted checkout ──────────────────────────────────

    async startCheckout(
        userId: string,
        dto: StartCheckout
    ): Promise<{ checkoutUrl: string }> {
        return this.withBillingLock(userId, () =>
            this.startCheckoutLocked(userId, dto)
        );
    }

    private async startCheckoutLocked(
        userId: string,
        dto: StartCheckout
    ): Promise<{ checkoutUrl: string }> {
        this.assertUniverseEnabled(dto.universe);
        const user = await this.usersService.findById(userId);
        if (!user) {
            throw new BadRequestException({
                code: RESPONSE_CODE.NOT_FOUND,
                message: 'User not found',
            });
        }

        const existing = await this.getProfile(userId);
        // Живий профіль (ACTIVE/PAST_DUE) — це не перша купівля: додавання йде
        // через зміну ємності, прострочка — через resume. Перевірка БЕЗ умови на
        // cardToken: скасований-до-кінця-періоду профіль (cancel занулює токен,
        // статус лишається ACTIVE) все ще оплачений — upsert нижче зніс би його
        // склади і доступ посеред оплаченого періоду. Checkout дозволений лише
        // коли доступу немає: профіль відсутній / INCOMPLETE / CANCELED / UNPAID.
        if (existing && this.isEntitled(existing)) {
            // Скасований профіль, чий оплачений період уже минув, — фактично
            // згаслий: він лише чекає cron-згасання (PaymentsCleanupService).
            // Не блокуємо повторну купівлю до крону — гасимо тут же (той самий
            // retire: CANCELED + реконсиляція прикріплених) і продовжуємо як з
            // чистим профілем.
            if (this.isCanceledPastPeriodEnd(existing)) {
                await this.retireEmptyProfile(userId, existing);
            } else {
                throw new ConflictException({
                    code: RESPONSE_CODE.BILLING_ALREADY_ACTIVE,
                    message: 'Billing profile already active',
                });
            }
        }

        const attachId = dto.attachBusinessId ?? null;
        if (attachId) await this.assertBusinessAccess(userId, attachId);

        const desired = this.buildDesiredWarehouses(dto, attachId);
        const amount = this.monthlyAmount(desired);
        if (amount <= 0) {
            throw new BadRequestException({
                code: RESPONSE_CODE.INVALID_CAPACITY,
                message: 'Nothing to purchase',
            });
        }

        // INCOMPLETE-профіль з бажаним складом: доступу ще немає (isEntitled
        // дивиться на статус), success-вебхук активує і поставить день-якір.
        await this.profileModel.updateOne(
            { userId: new Types.ObjectId(userId) },
            {
                $set: {
                    provider: PROVIDER,
                    walletId: userId,
                    currency: BILLING_CURRENCY,
                    status: SUBSCRIPTION_STATUS.INCOMPLETE,
                    cancelAtPeriodEnd: false,
                    // pending-поля скидаються явно: активація звіряє сплачену
                    // суму з ефективним складом, stale pending з попереднього
                    // життя профілю зробив би її хибною.
                    brand: {
                        ...desired.brand,
                        pendingCapacity: null,
                        pendingKeepBusinessIds: [],
                    },
                    documents: {
                        ...desired.documents,
                        pendingTierSize: null,
                        pendingKeepBusinessIds: [],
                        credits: existing?.documents.credits ?? {
                            balance: 0,
                            storageBytesUsed: 0,
                        },
                    },
                },
                $setOnInsert: { userId: new Types.ObjectId(userId) },
            },
            { upsert: true }
        );

        const orderReference = buildCheckoutOrderReference(userId);
        const result = await this.provider.createSubscriptionCheckout({
            userId,
            userEmail: user.email,
            orderReference,
            walletId: userId,
            planName: this.universeLabel(dto.universe),
            amount,
            currency: BILLING_CURRENCY,
            serviceUrl: this.serviceUrl(),
            returnUrl: this.returnUrl(dto.returnPath),
        });
        return { checkoutUrl: result.checkoutUrl };
    }

    private buildDesiredWarehouses(
        dto: StartCheckout,
        attachId: string | null
    ): {
        brand: { capacity: number; attachedBusinessIds: Types.ObjectId[] };
        documents: {
            tierSize: number | null;
            attachedBusinessIds: Types.ObjectId[];
        };
    } {
        const attach = attachId ? [new Types.ObjectId(attachId)] : [];
        if (dto.universe === BILLING_UNIVERSE.BRAND) {
            const capacity = dto.capacity ?? 0;
            if (capacity < 1) {
                throw new BadRequestException({
                    code: RESPONSE_CODE.INVALID_CAPACITY,
                    message: 'capacity must be ≥ 1',
                });
            }
            if (attach.length > capacity) {
                throw new BadRequestException({
                    code: RESPONSE_CODE.BILLING_CAPACITY_EXCEEDED,
                    message: 'attach exceeds capacity',
                });
            }
            return {
                brand: { capacity, attachedBusinessIds: attach },
                documents: { tierSize: null, attachedBusinessIds: [] },
            };
        }
        const tierSize = dto.tierSize ?? 0;
        const tier = findDocumentsTierBySize(this.grid.documents, tierSize);
        if (!tier) {
            throw new BadRequestException({
                code: RESPONSE_CODE.INVALID_TIER,
                message: 'Unknown documents tier',
            });
        }
        if (attach.length > tier.size) {
            throw new BadRequestException({
                code: RESPONSE_CODE.BILLING_CAPACITY_EXCEEDED,
                message: 'attach exceeds tier capacity',
            });
        }
        return {
            brand: { capacity: 0, attachedBusinessIds: [] },
            documents: { tierSize, attachedBusinessIds: attach },
        };
    }

    // ── Capacity change (existing token) ─────────────────────────────────

    async changeCapacity(
        userId: string,
        dto: ChangeCapacity
    ): Promise<{ immediateCharge: number; scheduled: boolean }> {
        return this.withBillingLock(userId, () =>
            this.changeCapacityLocked(userId, dto)
        );
    }

    private async changeCapacityLocked(
        userId: string,
        dto: ChangeCapacity
    ): Promise<{ immediateCharge: number; scheduled: boolean }> {
        this.assertUniverseEnabled(dto.universe);
        const profile = await this.requireChargeableProfile(userId);
        await this.assertNoUnsettledCharge(userId);

        const current = this.universeCapacityValue(profile, dto.universe);
        const target = this.targetCapacityValue(dto);

        // Атомарне прикріплення має сенс лише разом зі збільшенням ємності:
        // у вільний слот прикріплює окремий безкоштовний ендпоінт /attach.
        const attachId = dto.attachBusinessId ?? null;
        if (attachId && target <= current.value) {
            throw new BadRequestException({
                code: RESPONSE_CODE.INVALID_CAPACITY,
                message: 'attachBusinessId requires a capacity increase',
            });
        }

        if (target === current.value) {
            // «Повернути як було» = скасувати заплановане зменшення, якщо є.
            // Без цього шляху відкладене зменшення неможливо було б відкликати:
            // no-op лишав би stale pending, який на межі циклу зрізав би ємність.
            await this.clearScheduledDecrease(userId, dto.universe);
            return { immediateCharge: 0, scheduled: false };
        }

        const currentMonthly = this.universeMonthly(
            dto.universe,
            current.value
        );
        const targetMonthly = this.universeMonthly(dto.universe, target);

        // Класифікація за ЄМНІСТЮ (кількість слотів / розмір пакета), НЕ за сумою:
        // більший-дешевший документний пакет (оптова знижка з .env) — це теж
        // збільшення, лише з нульовою доплатою. Доплата рахується окремо як
        // пропорція від ДОДАТНОЇ різниці суми (дешевший-більший → доплати немає).
        if (target > current.value) {
            // Розширення можливе лише на оплаченому циклі. У PAST_DUE період
            // уже минув: daysRemaining=0 → пропорційна доплата нульова, і нова
            // ємність (разом з brandedAt прикріпленого бізнесу) діставалась би
            // безкоштовно на весь dunning-грейс. Спершу оплата простроченого
            // (resume), потім розширення. Зменшення нижче лишається доступним:
            // воно безгрошове і ЗНИЖУЄ суму наступної dunning-спроби.
            if (profile.status !== SUBSCRIPTION_STATUS.ACTIVE) {
                throw new BadRequestException({
                    code: RESPONSE_CODE.BILLING_PAST_DUE,
                    message: 'Pay the overdue cycle before increasing capacity',
                });
            }
            if (attachId) {
                await this.assertBusinessAccess(userId, attachId);
                const attachedNow = (
                    dto.universe === BILLING_UNIVERSE.BRAND
                        ? profile.brand.attachedBusinessIds
                        : profile.documents.attachedBusinessIds
                ).map((id) => id.toString());
                if (attachedNow.includes(attachId)) {
                    throw new ConflictException({
                        code: RESPONSE_CODE.BUSINESS_ALREADY_ATTACHED,
                        message: 'Business already attached',
                    });
                }
            }
            const { daysRemaining, daysInCycle } = this.cycleWindow(
                profile,
                new Date()
            );
            const charge = proratedShare(
                Math.max(0, targetMonthly - currentMonthly),
                daysRemaining,
                daysInCycle
            );
            const grantCredits =
                dto.universe === BILLING_UNIVERSE.DOCUMENTS
                    ? proratedShare(
                          Math.max(
                              0,
                              documentsMonthlyCredits(
                                  this.grid.documents,
                                  target
                              ) -
                                  documentsMonthlyCredits(
                                      this.grid.documents,
                                      current.value === 0 ? null : current.value
                                  )
                          ),
                          daysRemaining,
                          daysInCycle
                      )
                    : 0;

            const effect: PendingEffect = {
                universe: dto.universe,
                targetCapacity:
                    dto.universe === BILLING_UNIVERSE.BRAND ? target : null,
                targetTierSize:
                    dto.universe === BILLING_UNIVERSE.DOCUMENTS
                        ? target === 0
                            ? null
                            : target
                        : null,
                grantCredits,
                attachBusinessId: attachId,
            };

            if (charge <= 0) {
                // Більше ємності без доплати (крайній день циклу або
                // більший-дешевший пакет) — застосовуємо одразу.
                await this.applyEffectDirect(userId, effect);
                return { immediateCharge: 0, scheduled: false };
            }

            const pending = await this.chargeImmediate(
                userId,
                buildProrationOrderReference(userId),
                PAYMENT_RECORD_TYPE.PRORATION,
                charge,
                effect,
                this.universeLabel(dto.universe)
            );
            return { immediateCharge: charge, scheduled: pending };
        }

        // Зменшення ємності: діє з наступного циклу, без повернень.
        await this.scheduleDecrease(userId, dto, target);
        return { immediateCharge: 0, scheduled: true };
    }

    private async scheduleDecrease(
        userId: string,
        dto: ChangeCapacity,
        target: number
    ): Promise<void> {
        const keep = (dto.keepBusinessIds ?? []).map(
            (id) => new Types.ObjectId(id)
        );
        if (dto.universe === BILLING_UNIVERSE.BRAND) {
            await this.profileModel.updateOne(
                { userId: new Types.ObjectId(userId) },
                {
                    $set: {
                        'brand.pendingCapacity': target,
                        'brand.pendingKeepBusinessIds': keep,
                    },
                }
            );
        } else {
            await this.profileModel.updateOne(
                { userId: new Types.ObjectId(userId) },
                {
                    $set: {
                        'documents.pendingTierSize': target,
                        'documents.pendingKeepBusinessIds': keep,
                    },
                }
            );
        }
    }

    /** Скасовує заплановане зменшення ємності всесвіту (no-op, якщо його немає). */
    private async clearScheduledDecrease(
        userId: string,
        universe: BillingUniverse
    ): Promise<void> {
        const set =
            universe === BILLING_UNIVERSE.BRAND
                ? {
                      'brand.pendingCapacity': null,
                      'brand.pendingKeepBusinessIds': [],
                  }
                : {
                      'documents.pendingTierSize': null,
                      'documents.pendingKeepBusinessIds': [],
                  };
        await this.profileModel.updateOne(
            { userId: new Types.ObjectId(userId) },
            { $set: set }
        );
    }

    // ── Attachments (no charge) ──────────────────────────────────────────

    async attachBusiness(userId: string, dto: ManageAttachment): Promise<void> {
        return this.withBillingLock(userId, () =>
            this.attachBusinessLocked(userId, dto)
        );
    }

    private async attachBusinessLocked(
        userId: string,
        dto: ManageAttachment
    ): Promise<void> {
        let profile = await this.requireProfile(userId);
        // Прикріплення має сенс лише на живому доступі: на INCOMPLETE/CANCELED/
        // UNPAID профілі воно «успішно» заповнювало б слот без жодного ефекту
        // (реконсиляція брендує лише ACTIVE/PAST_DUE склади).
        if (!this.isEntitled(profile)) {
            throw new BadRequestException({
                code: RESPONSE_CODE.NO_ACTIVE_SUBSCRIPTION,
                message: 'No active billing profile',
            });
        }
        await this.assertBusinessAccess(userId, dto.businessId);
        // Спершу прибираємо мертві ref видалених бізнесів — інакше вони тримали б
        // слоти зайнятими і хибно блокували прикріплення при повній ємності.
        profile = await this.pruneDeadAttachments(userId, profile);
        const warehouse =
            dto.universe === BILLING_UNIVERSE.BRAND
                ? profile.brand
                : profile.documents;
        // Ємність для прикріплення — з урахуванням запланованого зменшення
        // (беремо мінімум поточної і майбутньої). Інакше прикріплення у слот,
        // що зникає на межі циклу, автоматика applyDecrease тихо відкріпила б
        // зі slug-rent (кастомні посилання скидаються без відновлення) — щойно
        // прикріплений бізнес не у pendingKeep-списку і вилетів би першим.
        // Шлях користувача: спершу скасувати зменшення, потім прикріпити.
        const effective = this.effectiveComposition(profile);
        const capacity =
            dto.universe === BILLING_UNIVERSE.BRAND
                ? Math.min(profile.brand.capacity, effective.brandCapacity)
                : Math.min(
                      profile.documents.tierSize ?? 0,
                      effective.documentsTierSize ?? 0
                  );
        const attached = warehouse.attachedBusinessIds.map((id) =>
            id.toString()
        );
        if (attached.includes(dto.businessId)) {
            throw new ConflictException({
                code: RESPONSE_CODE.BUSINESS_ALREADY_ATTACHED,
                message: 'Business already attached',
            });
        }
        if (attached.length >= capacity) {
            throw new BadRequestException({
                code: RESPONSE_CODE.BILLING_CAPACITY_EXCEEDED,
                message: 'No free slot: increase capacity first',
            });
        }
        const field =
            dto.universe === BILLING_UNIVERSE.BRAND
                ? 'brand.attachedBusinessIds'
                : 'documents.attachedBusinessIds';
        // Durable-маркер ДО реконсиляції: якщо `reconcileBusinesses` кине
        // транзієнтну помилку, daily-sweep (`retryPendingReconciles`) добʼє —
        // інакше бізнес лишився б прикріплений і оплачений, але з `brandedAt=null`
        // (slug/логотип гейтяться як безкоштовні) без автовідновлення.
        const marker = new Date();
        await this.profileModel.updateOne(
            { userId: new Types.ObjectId(userId) },
            {
                $addToSet: { [field]: new Types.ObjectId(dto.businessId) },
                $set: { reconcileRequiredAt: marker },
            }
        );
        // Прохід — по ПОВНОМУ боргу профілю, не лише по щойно прикріпленому:
        // наш стемп перезаписав можливий старіший маркер незавершеної
        // реконсиляції, тож зняття після вузького проходу стерло б її
        // durable-слід (див. owedReconcileIds).
        const complete = await this.reconcileBusinessesSafe(
            this.owedReconcileIds(profile, [dto.businessId])
        );
        if (complete) await this.clearReconcileMarker(userId, marker);
    }

    async detachBusiness(userId: string, dto: ManageAttachment): Promise<void> {
        return this.withBillingLock(userId, () =>
            this.detachBusinessLocked(userId, dto)
        );
    }

    private async detachBusinessLocked(
        userId: string,
        dto: ManageAttachment
    ): Promise<void> {
        const profile = await this.requireProfile(userId);
        const warehouse =
            dto.universe === BILLING_UNIVERSE.BRAND
                ? profile.brand
                : profile.documents;
        const attached = warehouse.attachedBusinessIds.map((id) =>
            id.toString()
        );
        if (!attached.includes(dto.businessId)) {
            throw new BadRequestException({
                code: RESPONSE_CODE.BUSINESS_NOT_ATTACHED,
                message: 'Business not attached',
            });
        }
        const field =
            dto.universe === BILLING_UNIVERSE.BRAND
                ? 'brand.attachedBusinessIds'
                : 'documents.attachedBusinessIds';
        // Слот звільнено — сума не змінюється (ціна = ємність, не прикріплення).
        // Durable-маркер навколо реконсиляції (див. attach): транзієнтний збій
        // добере daily-sweep, інакше бізнес лишився б з активним `brandedAt`.
        const marker = new Date();
        await this.profileModel.updateOne(
            { userId: new Types.ObjectId(userId) },
            {
                $pull: { [field]: new Types.ObjectId(dto.businessId) },
                $set: { reconcileRequiredAt: marker },
            }
        );
        // Повний борг профілю, не лише відкріплений бізнес (див. attach /
        // owedReconcileIds): інакше зняття маркера стерло б durable-слід
        // старішої незавершеної реконсиляції.
        const complete = await this.reconcileBusinessesSafe(
            this.owedReconcileIds(profile, [dto.businessId])
        );
        if (complete) await this.clearReconcileMarker(userId, marker);
    }

    /**
     * Знімає durable-маркер, але ЛИШЕ якщо він не новіший за `notAfter` (момент
     * нашого стемпа). Конкурентний стемп, поставлений ПІСЛЯ (інший тригер поза
     * нашим локом, напр. cleanup-cron), мусить пережити зняття — безумовний
     * clear загубив би єдиний durable-тригер тієї реконсиляції. `$lte` заразом
     * не матчить null-маркер (BSON type bracketing) — no-op без маркера.
     *
     * ПЕРЕДУМОВА виклику: caller щойно зробив повний прохід по
     * `owedReconcileIds` профілю. Маркер один на профіль, і наш стемп
     * перезаписує старіший, тож зняття після вузького проходу стерло б
     * durable-слід чужої незавершеної реконсиляції (разом зі списком
     * `pendingReconcileBusinessIds` нижче).
     */
    private async clearReconcileMarker(
        userId: string,
        notAfter: Date
    ): Promise<void> {
        await this.profileModel.updateOne(
            {
                userId: new Types.ObjectId(userId),
                reconcileRequiredAt: { $lte: notAfter },
            },
            // pendingReconcileBusinessIds чистяться разом з маркером: гейт
            // $lte гарантує, що ID, дописані конкурентним стемпом після нашого
            // читання (той стемп завжди ставить новіший маркер), переживуть.
            {
                $set: {
                    reconcileRequiredAt: null,
                    pendingReconcileBusinessIds: [],
                },
            }
        );
    }

    // ── Buy credits (docupівля, immediate) ───────────────────────────────

    async buyCredits(
        userId: string,
        dto: BuyCredits
    ): Promise<{ charged: number; scheduled: boolean }> {
        return this.withBillingLock(userId, () =>
            this.buyCreditsLocked(userId, dto)
        );
    }

    private async buyCreditsLocked(
        userId: string,
        dto: BuyCredits
    ): Promise<{ charged: number; scheduled: boolean }> {
        const profile = await this.requireChargeableProfile(userId);
        await this.assertNoUnsettledCharge(userId);
        if (profile.documents.tierSize === null) {
            throw new BadRequestException({
                code: RESPONSE_CODE.BILLING_UNIVERSE_DISABLED,
                message: 'Documents subscription required to buy credits',
            });
        }
        // Пакет матчиться за ЗНАЧЕННЯМ (credits + priceAmount), не за індексом:
        // запит несе очікувану ціну, тож редагування BILLING_DOC_CREDIT_PACKS
        // між показом і покупкою відхиляється тут замість списання іншої суми
        // (та сама amount-звірка, що на активації checkout).
        const pack = this.grid.documents.creditPacks.find(
            (p) =>
                p.credits === dto.credits && p.priceAmount === dto.priceAmount
        );
        if (!pack) {
            throw new BadRequestException({
                code: RESPONSE_CODE.INVALID_CREDIT_PACK,
                message: 'Credit pack not found at this price',
            });
        }
        // targetTierSize: null — докупівля НЕ міняє пакет, лише нараховує
        // кредити (і не сміє скасувати заплановане зменшення пакета).
        const effect: PendingEffect = {
            universe: BILLING_UNIVERSE.DOCUMENTS,
            targetCapacity: null,
            targetTierSize: null,
            grantCredits: pack.credits,
            attachBusinessId: null,
        };
        const pending = await this.chargeImmediate(
            userId,
            buildCreditPackOrderReference(userId),
            PAYMENT_RECORD_TYPE.CREDIT_PACK,
            pack.priceAmount,
            effect,
            'Докупівля кредитів'
        );
        return { charged: pack.priceAmount, scheduled: pending };
    }

    // ── Saved card lifecycle ─────────────────────────────────────────────

    /**
     * $set-фрагмент забуття картки: сам токен і всі поля, за якими кабінет її
     * показує. Стирати треба разом — самого токена мало: лишена маска малювала
     * б у кабінеті картку, якої вже немає, і платник тиснув би оплату, під якою
     * порожньо. `cardVerifiedAt` іде туди ж: строк зберігання саме цієї картки
     * відбуто, а наступна прив'язка поставить власну дату.
     *
     * Сліди вимкнення доступу (`dunningExhaustedAt`, `disabledSnapshot`) тут
     * НЕ чіпаються, і це принципово: доступ лишається вимкненим, а стерта
     * мітка зробила б стан невидимим для строку зберігання — картка, вписана
     * після стирання попередньої, не мала б від чого відраховувати свої дні і
     * лишалась би у гаманці банку назавжди. Знімає їх лише те, що справді
     * змінює стан: оживлення профілю (`freshCycleFields`, `advanceCycle`) або
     * його остаточне згасання (`retireEmptyProfile`).
     */
    private forgetCardFields(): Record<string, null> {
        return {
            cardToken: null,
            ...blankCardFields(),
            cardVerifiedAt: null,
        };
    }

    /**
     * $set-фрагмент «профіль більше не вимкнений за несплатою»: мітка відліку
     * строку зберігання картки і знімок складу з моменту вимкнення. Обидва
     * описують саме той стан, тож зникають разом з ним — коли профіль ожив
     * оплатою або погас назавжди.
     */
    private clearDisabledStateFields(): Record<string, null> {
        return { dunningExhaustedAt: null, disabledSnapshot: null };
    }

    /**
     * $set-фрагмент картки, що прийшла разом з оплатою, і токен, який ця оплата
     * витіснила. Сторінка банку дозволяє ввести ІНШУ картку, і тоді це заміна, а
     * не оновлення тієї самої: поля показу гасяться перед записом нових (див.
     * `blankCardFields`), а попередній токен caller ставить у чергу відкликання
     * тим самим записом. Інакше стара картка лишалась би в гаманці monobank
     * назавжди. Той самий токен або його відсутність (списання за карткою
     * зазвичай токена не повертає) — звичайне оновлення даних тієї самої картки.
     */
    private paidCardUpdates(
        currentToken: string | null,
        card: CardDetails,
        paidToken: string | null
    ): { set: Record<string, unknown>; replacedToken: string | null } {
        const replacedToken =
            paidToken && currentToken && paidToken !== currentToken
                ? currentToken
                : null;
        return {
            set: {
                ...(replacedToken ? blankCardFields() : {}),
                ...cardProfileFields(card),
                ...(paidToken ? { cardToken: paidToken } : {}),
            },
            replacedToken,
        };
    }

    /**
     * Відкликає у гаманці провайдера токен із черги профілю і лише після
     * відповіді банку прибирає його з черги. Порядок «спершу наша база, потім
     * банк» лишається (зворотний лишав би профіль з токеном, який банк уже не
     * приймає), але збій банку більше не губить токен: він чекає наступного
     * проходу `revokePendingCardTokens`.
     *
     * Під per-user локом, бо перевірка «токен знову не став робочим» мусить
     * бути свіжою: банк може повернути той самий токен на повторну прив'язку
     * тієї ж картки, і тоді відкликання вбило б чинну картку. Лок тримається
     * рівно на один виклик провайдера. Ніколи не кидає: зайнятий лок чи збій
     * банку лише відкладають відкликання.
     *
     * Відкладання НЕ безстрокове: після
     * `BILLING_CARD_REVOCATION_MAX_FAILURES` відмов банку поспіль токен
     * виходить з черги, а ops отримує лист. Інакше недоступність банку
     * тримала б профіль живим назавжди, а з ним зависало б і остаточне
     * видалення акаунта, яке чекає на порожню чергу (`purgeUser`).
     */
    private async revokeQueuedCardToken(
        userId: string,
        cardToken: string
    ): Promise<void> {
        try {
            await this.withBillingLock(userId, async () => {
                const uid = new Types.ObjectId(userId);
                const profile = await this.profileModel
                    .findOne(
                        { userId: uid, pendingRevokeCardTokens: cardToken },
                        { cardToken: 1, cardRevocationFailures: 1 }
                    )
                    .lean();
                if (!profile) return;
                if (
                    profile.cardToken !== cardToken &&
                    !(await this.deleteCardTokenAtProvider(userId, cardToken))
                ) {
                    const failures = profile.cardRevocationFailures + 1;
                    if (failures < BILLING_CARD_REVOCATION_MAX_FAILURES) {
                        await this.profileModel.updateOne(
                            { userId: uid },
                            { $set: { cardRevocationFailures: failures } }
                        );
                        return;
                    }
                    // Мітка листа — тим самим записом, що виводить токен з
                    // черги: інакше збій відправки лишив би картку в гаманці
                    // без жодного сліду, за яким її знайти (див.
                    // `cardRevocationAlertDueAt`).
                    await this.dropRevocationQueueEntry(uid, cardToken, {
                        cardRevocationAlertDueAt: new Date(),
                    });
                    this.logger.error(
                        `Gave up revoking a card token of user ${userId} after ` +
                            `${failures} refusals — the card stays in the ` +
                            'monobank wallet, ops alert queued'
                    );
                    return;
                }
                // Банк прийняв відкликання (або токен знову став чинним) —
                // ланцюг відмов обірвано.
                await this.dropRevocationQueueEntry(uid, cardToken);
            });
        } catch (error) {
            if (isBillingLockBusy(error)) {
                this.logger.warn(
                    `Card revocation for user ${userId} deferred: billing busy`
                );
                return;
            }
            this.logger.error(
                `Card revocation for user ${userId} failed, kept in queue`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    /**
     * Токен виходить з черги відкликання. Лічильник відмов обнуляється тим
     * самим записом: він рахує саме ВІДМОВИ ПОСПІЛЬ по цьому платнику, і
     * наступний токен мусить починати відлік з нуля.
     */
    private async dropRevocationQueueEntry(
        uid: Types.ObjectId,
        cardToken: string,
        extraSet: Record<string, unknown> = {}
    ): Promise<void> {
        await this.profileModel.updateOne(
            { userId: uid },
            {
                $pull: { pendingRevokeCardTokens: cardToken },
                $set: { cardRevocationFailures: 0, ...extraSet },
            }
        );
    }

    /**
     * Лист ops про кожну картку, яку черга відкликань здала. Фоном, а не в
     * момент відступу: мітку знімає лише успішна відправка, тож збій пошти
     * відкладає лист, а не губить його разом з єдиним слідом картки. Збій
     * одного листа не зриває решти.
     */
    async sendCardRevocationAlerts(): Promise<void> {
        const due = await this.profileModel
            .find(
                { cardRevocationAlertDueAt: { $type: 'date' } },
                { userId: 1, walletId: 1, cardRevocationAlertDueAt: 1 }
            )
            .lean();
        for (const profile of due) {
            const userId = profile.userId.toString();
            try {
                await this.emailService.sendCardRevocationFailed({
                    userId,
                    walletId: profile.walletId,
                    attempts: BILLING_CARD_REVOCATION_MAX_FAILURES,
                });
                // Лише якщо за час відправки не з'явився новий відступ: тоді
                // мітка новіша, і лист піде ще раз, уже про нього.
                await this.profileModel.updateOne(
                    {
                        _id: profile._id,
                        cardRevocationAlertDueAt:
                            profile.cardRevocationAlertDueAt,
                    },
                    { $set: { cardRevocationAlertDueAt: null } }
                );
            } catch (error) {
                this.logger.error(
                    `Failed to send card revocation alert for user ${userId}`,
                    error instanceof Error ? error.stack : String(error)
                );
            }
        }
    }

    /**
     * Один запит відкликання. `true` — токена у гаманці більше немає, з черги
     * його можна прибрати. Відмова 400/404 теж остаточна: банк такого токена
     * не знає (провайдер його ротував або прибрав сам), і повтор нічого не
     * змінить, а безкінечна черга блокувала б видалення акаунта. Решта
     * (мережа, 5xx, ліміт, помилка доступу) — `false`, токен чекає повтору.
     */
    private async deleteCardTokenAtProvider(
        userId: string,
        cardToken: string
    ): Promise<boolean> {
        // Черга відкликань може тримати кілька токенів одного платника, тож
        // самого userId для розбору логів мало. Іншого унікального поля у
        // токена немає: маску картки `forgetCardFields` гасить ще до того, як
        // токен стає в чергу. Тому в лог іде необоротний відбиток — два рядки
        // про той самий токен видно як той самий, а платіжним секретом
        // відбиток не є (див. `cardTokenFingerprint`).
        const fingerprint = cardTokenFingerprint(cardToken);
        try {
            await this.provider.deleteCardToken(cardToken);
            return true;
        } catch (error) {
            if (
                error instanceof ProviderRequestError &&
                (error.status === 400 || error.status === 404)
            ) {
                this.logger.error(
                    `Provider rejected card revocation for user ${userId} ` +
                        `(card ${fingerprint}: ${error.message}) — dropped from queue`
                );
                return true;
            }
            this.logger.error(
                `Failed to revoke card token ${fingerprint} of user ${userId}, ` +
                    'will retry',
                error instanceof Error ? error.stack : String(error)
            );
            return false;
        }
    }

    /**
     * Фоновий повтор відкликань: усе, що профілі забули, а банк ще не
     * підтвердив. Збій одного токена не зриває проходу.
     */
    async revokePendingCardTokens(): Promise<void> {
        const profiles = await this.profileModel
            .find(
                { pendingRevokeCardTokens: { $type: 'string' } },
                { userId: 1, pendingRevokeCardTokens: 1 }
            )
            .lean();
        if (profiles.length === 0) return;
        this.logger.log(
            `Revoking queued card tokens of ${profiles.length} profile(s)`
        );
        for (const profile of profiles) {
            for (const cardToken of profile.pendingRevokeCardTokens) {
                await this.revokeQueuedCardToken(
                    profile.userId.toString(),
                    cardToken
                );
            }
        }
    }

    /**
     * Відкликання черги одного платника одразу після обробки оплати, що могла
     * витіснити картку: не чекаючи фонового проходу. Порожня черга — no-op.
     */
    private async revokeQueuedCardTokensOf(userId: string): Promise<void> {
        const profile = await this.profileModel
            .findOne(
                { userId: new Types.ObjectId(userId) },
                { pendingRevokeCardTokens: 1 }
            )
            .lean();
        for (const cardToken of profile?.pendingRevokeCardTokens ?? []) {
            await this.revokeQueuedCardToken(userId, cardToken);
        }
    }

    /**
     * Виконує відкладені побічні ефекти після звільнення лока. Кожен
     * ізольований: збій одного не зриває решти і не перетворює вже успішну
     * обробку на помилку.
     */
    private async runAfterLock(tasks: AfterLockTask[]): Promise<void> {
        for (const task of tasks) {
            try {
                await task();
            } catch (error) {
                this.logger.error(
                    'Post-lock billing task failed',
                    error instanceof Error ? error.stack : String(error)
                );
            }
        }
    }

    /**
     * Стирає картки погашених профілів: підписка завершилась рішенням самого
     * платника або зникненням акаунта. Вибірка за наявністю картки, а не за
     * моментом згасання: картка, яку не вдалось стерти в годину згасання
     * (зайнятий лок, падіння процесу), підбирається наступним проходом.
     */
    async forgetCardsOfEndedSubscriptions(): Promise<void> {
        await this.forgetCardsWhere({ status: SUBSCRIPTION_STATUS.CANCELED });
    }

    /**
     * Стирає картки платників, яких вибило несплатою, коли строк зберігання
     * минув. Відлік від пізнішої з двох дат — вимкнення доступу чи останньої
     * прив'язки картки: картка, вписана вже після вимкнення, отримує власний
     * строк.
     *
     * Вибірка за самим СТАНОМ «доступ вимкнено несплатою», а не за наявністю
     * мітки вимкнення. Мітки може не бути зовсім: її не мають профілі, вимкнені
     * до Sprint 43. Тоді єдина відома дата — прив'язка картки, а якщо невідома
     * й вона, картка у вимкненому профілі однаково нічого не чекає і йде тим
     * самим проходом. Вибірка по самій мітці лишала б такі картки у гаманці
     * банку назавжди.
     */
    async forgetCardsPastRetention(): Promise<void> {
        const cutoff = new Date(
            Date.now() - BILLING_CARD_RETENTION_DAYS * DAY_MS
        );
        const settledBefore = (
            field: string
        ): FilterQuery<BillingProfileDocument> => ({
            $or: [{ [field]: null }, { [field]: { $lt: cutoff } }],
        });
        // Через `$and`, бо кожна умова несе власний `$or`.
        await this.forgetCardsWhere({
            $and: [
                this.disabledByNonPaymentFilter(),
                settledBefore('dunningExhaustedAt'),
                settledBefore('cardVerifiedAt'),
            ],
        });
    }

    /**
     * Умова стирання повторюється у самому записі, під per-user локом: між
     * вибіркою і стиранням платник міг повернути доступ чи купити заново, і
     * тоді стерлась би вже нова, робоча картка, а планувальник мовчки
     * пропускав би профіль без картки. Стертий токен тим самим записом стає в
     * чергу відкликання: у банку відкликається рівно він, а збій банку його
     * не губить (див. `revokePendingCardTokens`, що йде наступним кроком
     * прибирання). Збій одного профілю не зриває проходу.
     */
    private async forgetCardsWhere(
        condition: FilterQuery<BillingProfileDocument>
    ): Promise<void> {
        const filter: FilterQuery<BillingProfileDocument> = {
            ...condition,
            cardToken: { $type: 'string' },
        };
        const profiles = await this.profileModel
            .find(filter, { userId: 1 })
            .lean();
        if (profiles.length === 0) return;
        this.logger.log(`Forgetting ${profiles.length} saved card(s)`);
        for (const { userId } of profiles) {
            try {
                await this.withBillingLock(userId.toString(), async () => {
                    const current = await this.profileModel
                        .findOne({ ...filter, userId }, { cardToken: 1 })
                        .lean();
                    if (!current?.cardToken) return;
                    // Фільтр за самим токеном: у чергу стає саме той, що
                    // стирається цим записом.
                    await this.profileModel.updateOne(
                        { ...filter, userId, cardToken: current.cardToken },
                        {
                            $set: this.forgetCardFields(),
                            $addToSet: {
                                pendingRevokeCardTokens: current.cardToken,
                            },
                        }
                    );
                });
            } catch (error) {
                this.logger.error(
                    `Failed to forget saved card of user ${userId.toString()}`,
                    error instanceof Error ? error.stack : String(error)
                );
            }
        }
    }

    /**
     * Хостована сторінка прив'язки картки. Рахунок на нуль: банк проводить його
     * як верифікацію картки без списання, тож дія безгрошова у будь-якому стані
     * профілю. Доступна скрізь, де запис про підписку вже існує, включно з
     * вимкненою за несплатою: саме там заміна найпотрібніша.
     */
    async startCardVerification(
        userId: string,
        dto: StartCardVerification
    ): Promise<{ checkoutUrl: string }> {
        return this.withBillingLock(userId, () =>
            this.startCardVerificationLocked(userId, dto)
        );
    }

    private async startCardVerificationLocked(
        userId: string,
        dto: StartCardVerification
    ): Promise<{ checkoutUrl: string }> {
        // Гейта «лише оплачений профіль» тут свідомо немає, і це не недогляд.
        // Запис підписки з'являється вже на відкритті сторінки оплати, тож
        // картку теоретично можна зберегти профілю, який нічого не купив, і
        // жодна фонова чистка його не бачить (одна ходить по скасованих, друга
        // по вимкнених за несплатою). Осиротілий токен усе одно не живе довго:
        // списати ним не можна (`requireChargeableProfile`), перша ж успішна
        // купівля витісняє його новим і ставить у чергу відкликання
        // (`paidCardUpdates`), а видалення акаунта гасить профіль у CANCELED,
        // звідки його забирає погодинне стирання. Додавати гейт означало б
        // відрізати заміну картки у станах, де вона найпотрібніша, заради
        // випадку, який лікує сам себе.
        const profile = await this.requireProfile(userId);
        const user = await this.usersService.findById(userId);
        if (!user) {
            throw new BadRequestException({
                code: RESPONSE_CODE.NOT_FOUND,
                message: 'User not found',
            });
        }
        const renewAfterSave = dto.renewAfterSave === true;
        // Намір відновлення звіряємо ДО походу в банк: інакше платник пройшов
        // би сторінку картки, повернувся, і не отримав би нічого, крім тиші.
        if (renewAfterSave) this.assertRenewable(profile);

        const orderReference = buildCardVerifyOrderReference(
            userId,
            renewAfterSave
        );
        const result = await this.provider.createCardVerification({
            userId,
            userEmail: user.email,
            orderReference,
            walletId: profile.walletId ?? userId,
            currency: profile.currency ?? BILLING_CURRENCY,
            serviceUrl: this.serviceUrl(),
            returnUrl: this.returnUrl(
                dto.returnPath,
                BILLING_RETURN_FLOW.CARD_VERIFICATION
            ),
        });
        await this.profileModel.updateOne(
            { userId: new Types.ObjectId(userId) },
            {
                $set: {
                    cardVerification: {
                        orderReference,
                        invoiceId: result.invoiceId,
                        status: CARD_VERIFICATION_STATUS.PENDING,
                    },
                },
            }
        );
        return { checkoutUrl: result.checkoutUrl };
    }

    /**
     * Результат прив'язки картки для сторінки повернення з банку. Платник
     * повертається раніше, ніж гарантовано приходить сповіщення банку, тож
     * незавершену спробу дозвіряємо запитом статусу рахунку і застосовуємо тим
     * самим шляхом, що й сповіщення. Ідентифікатор події в обох джерелах один,
     * тож пізніше сповіщення стає повтором і нічого не дублює.
     */
    async resolveCardVerification(
        userId: string
    ): Promise<CardVerificationResult> {
        const afterLock: AfterLockTask[] = [];
        try {
            return await this.withBillingLock(userId, () =>
                this.resolveCardVerificationLocked(userId, afterLock)
            );
        } finally {
            await this.runAfterLock(afterLock);
        }
    }

    private async resolveCardVerificationLocked(
        userId: string,
        afterLock: AfterLockTask[]
    ): Promise<CardVerificationResult> {
        const profile = await this.requireProfile(userId);
        const attempt = profile.cardVerification;
        if (!attempt) {
            throw new BadRequestException({
                code: RESPONSE_CODE.BILLING_NO_CARD_VERIFICATION,
                message: 'No card verification started',
            });
        }
        if (attempt.status !== CARD_VERIFICATION_STATUS.PENDING) {
            return { status: attempt.status };
        }
        const parsed = parseOrderReference(attempt.orderReference);
        if (!parsed) {
            throw new Error(
                `Malformed card verification reference ${attempt.orderReference}`
            );
        }
        let event: BillingWebhookEvent | null;
        try {
            event = await this.provider.getInvoiceStatus(
                attempt.invoiceId,
                attempt.orderReference
            );
        } catch (error) {
            this.logger.warn(
                `getInvoiceStatus failed for ${attempt.orderReference}: ` +
                    (error instanceof Error ? error.message : String(error))
            );
            return { status: CARD_VERIFICATION_STATUS.PENDING };
        }
        if (!event || this.isNonTerminal(event.status)) {
            return { status: CARD_VERIFICATION_STATUS.PENDING };
        }
        await this.routeTransaction(event, parsed, afterLock);
        const settled = (await this.getProfile(userId))?.cardVerification;
        return {
            status:
                settled?.orderReference === attempt.orderReference
                    ? settled.status
                    : CARD_VERIFICATION_STATUS.PENDING,
        };
    }

    /**
     * Спільна перевірка «є що відновлювати»: скасована підписка, чий оплачений
     * період ще триває. Читають обидва шляхи відновлення — пряма дія і прив'язка
     * картки з наміром відновити. Повертає межу періоду, щоб caller не звужував
     * той самий nullable вдруге.
     */
    private assertRenewable(profile: BillingProfileLean): Date {
        if (!profile.cancelAtPeriodEnd || !this.isEntitled(profile)) {
            throw new BadRequestException({
                code: RESPONSE_CODE.BILLING_NOT_CANCELED,
                message: 'Subscription is not canceled',
            });
        }
        const periodEnd = profile.currentPeriodEnd;
        if (!periodEnd || new Date(periodEnd).getTime() <= Date.now()) {
            throw new BadRequestException({
                code: RESPONSE_CODE.BILLING_PERIOD_ENDED,
                message: 'Paid period already ended, start a new purchase',
            });
        }
        return periodEnd;
    }

    /**
     * Ті самі умови, що перевіряє `assertRenewable`, але у вигляді фільтра
     * САМОГО запису: скасована підписка, той самий статус і та сама межа
     * періоду, збережена картка на місці.
     *
     * Перевірити їх на прочитаному профілі недостатньо. Фонове згасання
     * скасованих профілів (`PaymentsCleanupService`) працює без per-user лока,
     * тож між читанням і записом воно може встигнути погасити підписку — і без
     * цих умов ми відновили б щойно погашену, роздавши доступ безкоштовно.
     * Спільний для обох шляхів відновлення: прямої дії і прив'язки картки з
     * наміром відновити.
     */
    private renewableFilter(
        profile: BillingProfileLean
    ): FilterQuery<BillingProfileDocument> {
        return {
            cancelAtPeriodEnd: true,
            status: profile.status,
            currentPeriodEnd: profile.currentPeriodEnd,
            cardToken: { $ne: null },
        };
    }

    /**
     * $set відновлення підписки. Намір поновлювати повертається завжди, а вісь
     * планувальника (`nextChargeAt`) — лише якщо за платником не висить
     * списання з невідомим результатом.
     *
     * Таке списання свідомо зупиняє планувальник (`flagManualReview` занулює
     * `nextChargeAt`): поки невідомо, пройшли гроші чи ні, нових списань бути
     * не повинно. Відновлення, яке ставило б дату списання беззастережно, тихо
     * скасовувало б цю зупинку — і платник отримав би нове списання посеред
     * нерозібраного. Вісь повертає `clearChargeUncertainty`, щойно те списання
     * дійде фіналу: на ACTIVE-профілі без наміру скасування вона ставить
     * `currentPeriodEnd`, тобто рівно ту саму межу.
     *
     * Ознака — саме незакритий запис спроби, а не прапорець `needsManualReview`:
     * прапорець піднімає ще й зайвий платіж (`raiseManualReviewInTx`), який
     * планувальник не зупиняє, і гейт по ньому зупиняв би списання без причини.
     */
    private async renewUpdates(
        userId: string,
        periodEnd: Date,
        session?: ClientSession
    ): Promise<Record<string, unknown>> {
        const set: Record<string, unknown> = { cancelAtPeriodEnd: false };
        if (!(await this.hasUnsettledCharge(userId, session))) {
            set['nextChargeAt'] = periodEnd;
        }
        return set;
    }

    /**
     * Відновлення скасованої підписки одразу після збереження картки — другий
     * шлях тієї самої дії (перший — `renewLocked`). Окремий запис, а не поля у
     * записі картки: картку зберігаємо завжди, бо банк її вже токенізував, а
     * відновлення має право не відбутись. Не збіглось — картка лишається,
     * підписка ні, про що й каже лог.
     */
    private async renewAfterCardSaved(
        userId: string,
        before: BillingProfileLean,
        session: ClientSession
    ): Promise<void> {
        // Передумови за прочитаним профілем: фільтр нижче стереже від гонки,
        // але сам по собі він не відрізнить скасовану підписку від згаслої
        // (звіряє статус із тим, що ми прочитали, яким би він не був).
        const renewable =
            before.cancelAtPeriodEnd &&
            this.isEntitled(before) &&
            before.currentPeriodEnd != null &&
            new Date(before.currentPeriodEnd).getTime() > Date.now();
        if (renewable && before.currentPeriodEnd) {
            const result = await this.profileModel.updateOne(
                {
                    userId: new Types.ObjectId(userId),
                    ...this.renewableFilter(before),
                },
                {
                    $set: await this.renewUpdates(
                        userId,
                        before.currentPeriodEnd,
                        session
                    ),
                },
                { session, maxTimeMS: WEBHOOK_MONGO_TIMEOUT_MS }
            );
            if (result.matchedCount === 1) return;
        }
        this.logger.warn(
            `Card saved for ${userId}, but subscription is no longer ` +
                'renewable — card kept, renewal skipped'
        );
    }

    // ── Cancel / resume ──────────────────────────────────────────────────

    /**
     * Скасування фіксує РІВНО намір не поновлювати: планувальник зупиняється,
     * доступ доживає оплачений період. Збережена картка при цьому лишається на
     * місці до фактичного завершення підписки (`retireEmptyProfile` і фонове
     * згасання скасованих). Стирати її тут не можна: платник ще платник, а
     * втрата картки посеред оплаченого періоду відбирає у нього і відновлення
     * підписки, і заміну картки, і будь-яку платну дію.
     */
    async cancel(userId: string): Promise<void> {
        return this.withBillingLock(userId, async () => {
            const profile = await this.getProfile(userId);
            if (!profile || !this.isEntitled(profile)) {
                throw new BadRequestException({
                    code: RESPONSE_CODE.NO_ACTIVE_SUBSCRIPTION,
                    message: 'No active billing profile',
                });
            }
            await this.profileModel.updateOne(
                { userId: new Types.ObjectId(userId) },
                {
                    $set: {
                        cancelAtPeriodEnd: true,
                        nextChargeAt: null,
                        nextRetryAt: null,
                    },
                }
            );
        });
    }

    /**
     * Відкликає скасування, поки оплачений період ще триває. Грошей не рухає:
     * період уже оплачено, треба лише повернути намір поновлювати і поставити
     * планувальник назад на межу цього періоду. Тому це окрема дія, а не гілка
     * `resume` (той адресує борг і веде на сторінку оплати).
     *
     * Виняток для планувальника — списання з невідомим результатом: воно
     * зупиняє вісь свідомо, і відновлення її не повертає (див. `renewUpdates`).
     */
    async renew(userId: string): Promise<void> {
        return this.withBillingLock(userId, () => this.renewLocked(userId));
    }

    private async renewLocked(userId: string): Promise<void> {
        const profile = await this.requireProfile(userId);
        const periodEnd = this.assertRenewable(profile);
        // Без картки відновлення заборонене: підписка поновлювалась би, а на
        // межі списувати було б нічим — і профіль завис би у безкоштовному
        // доступі назавжди (клок пропускає профіль без картки, фонове згасання
        // шукає лише скасовані). Стан реальний одразу після розгортання: усім,
        // хто скасував раніше, картку вже стерто.
        if (!profile.cardToken) {
            throw new BadRequestException({
                code: RESPONSE_CODE.BILLING_CARD_REQUIRED,
                message: 'Add a card to resume the subscription',
            });
        }
        // Умови повторені у фільтрі, а не лише перевірені вище: фонове згасання
        // скасованих профілів працює без per-user лока, тож між читанням і
        // записом воно може встигнути погасити профіль. Без фільтра ми б
        // відновили щойно погашену підписку і роздали доступ безкоштовно.
        const updated = await this.profileModel.updateOne(
            {
                userId: new Types.ObjectId(userId),
                ...this.renewableFilter(profile),
            },
            { $set: await this.renewUpdates(userId, periodEnd) }
        );
        if (updated.matchedCount === 0) {
            throw new ConflictException({
                code: RESPONSE_CODE.BILLING_OPERATION_IN_PROGRESS,
                message: 'Profile changed meanwhile, retry',
            });
        }
    }

    async resume(
        userId: string,
        returnPath?: string
    ): Promise<{ checkoutUrl: string }> {
        return this.withBillingLock(userId, () =>
            this.resumeLocked(userId, returnPath)
        );
    }

    private async resumeLocked(
        userId: string,
        returnPath?: string
    ): Promise<{ checkoutUrl: string }> {
        const profile = await this.getProfile(userId);
        if (!profile || profile.status !== SUBSCRIPTION_STATUS.PAST_DUE) {
            throw new BadRequestException({
                code: RESPONSE_CODE.SUBSCRIPTION_NOT_PAST_DUE,
                message: 'Billing profile is not past due',
            });
        }
        // Незавершене списання означає, що за цей самий місяць уже можуть іти
        // гроші (спроба з нерозв'язаним результатом). Друга оплата закрити той
        // самий місяць удруге не зможе і осяде у ручному розборі, тож не даємо
        // її почати: вікно коротке, завислий запис добиває вебхук або звірка.
        await this.assertNoUnsettledCharge(userId);
        const user = await this.usersService.findById(userId);
        if (!user) {
            throw new BadRequestException({
                code: RESPONSE_CODE.NOT_FOUND,
                message: 'User not found',
            });
        }
        // Resume оплачує НОВИЙ цикл, тож сума — за ефективним складом
        // (заплановані зменшення активація застосує разом з оплатою).
        const amount = this.effectiveMonthlyAmount(profile);
        const orderReference = buildCheckoutOrderReference(userId);
        const result = await this.provider.createSubscriptionCheckout({
            userId,
            userEmail: user.email,
            orderReference,
            walletId: profile.walletId ?? userId,
            planName: 'Оплата за поточний період',
            amount,
            currency: profile.currency ?? BILLING_CURRENCY,
            serviceUrl: this.serviceUrl(),
            returnUrl: this.returnUrl(returnPath),
        });
        const holdUntil = Date.now() + RESUME_DUNNING_HOLD_MS;
        const existingRetry = profile.nextRetryAt
            ? new Date(profile.nextRetryAt).getTime()
            : 0;
        await this.profileModel.updateOne(
            { userId: new Types.ObjectId(userId) },
            {
                $set: {
                    nextRetryAt: new Date(Math.max(holdUntil, existingRetry)),
                },
            }
        );
        return { checkoutUrl: result.checkoutUrl };
    }

    // ── Reactivation after access was switched off ───────────────────────

    /**
     * Повернення після вимкнення доступу: списання збереженою карткою без
     * сторінки банку. Відкриває НОВИЙ місяць від дня оплати, а дні прострочки
     * прощаються (див. `freshCycleFields`). Сума рахується за складом, який
     * лишився у профілі, з застосованими відкладеними зменшеннями.
     */
    async reactivate(userId: string): Promise<{ scheduled: boolean }> {
        return this.withBillingLock(userId, () =>
            this.reactivateLocked(userId)
        );
    }

    private async reactivateLocked(
        userId: string
    ): Promise<{ scheduled: boolean }> {
        const profile = await this.requireProfile(userId);
        if (!this.isAccessDisabledByNonPayment(profile)) {
            throw new BadRequestException({
                code: RESPONSE_CODE.BILLING_NOT_DISABLED,
                message: 'Access is not switched off for non-payment',
            });
        }
        if (!profile.cardToken) {
            throw new BadRequestException({
                code: RESPONSE_CODE.BILLING_CARD_REQUIRED,
                message: 'Add a card to pay',
            });
        }
        await this.assertNoUnsettledCharge(userId);
        // Сума — за складом на момент вимкнення, а не за живими полями: їх міг
        // переписати покинутий checkout (див. `disabledComposition`).
        const amount = this.effectiveMonthlyAmount(
            this.disabledComposition(profile)
        );
        if (amount <= 0) {
            throw new BadRequestException({
                code: RESPONSE_CODE.INVALID_CAPACITY,
                message: 'Nothing to pay for',
            });
        }
        // Межа, на якій доступ вимкнули, стабільна для вимкненого профілю
        // (нова купівля її не чіпає), тож
        // ідентифікатор спроби детермінований: друге натискання (дві вкладки,
        // нетерплячий клік) натрапляє на наявний запис і йде звіркою.
        const boundary = profile.currentPeriodEnd ?? profile.updatedAt;
        const orderReference = buildReactivationOrderReference(
            userId,
            boundary
        );
        const currency = profile.currency ?? BILLING_CURRENCY;

        const scheduled = await this.chargeSavedCard(userId, {
            cardToken: profile.cardToken,
            orderReference,
            type: PAYMENT_RECORD_TYPE.CYCLE,
            amount,
            currency,
            pendingEffect: null,
            productName: 'Поновлення підписки Finly',
            label: 'Reactivation charge',
            onSuccess: (result) =>
                this.settleReactivation(
                    userId,
                    orderReference,
                    result.invoiceId,
                    result,
                    result.cardToken
                ),
        });
        return { scheduled };
    }

    /**
     * Success повернення: settle запису спроби і відкриття нового циклу в одній
     * транзакції, далі реконсиляція прикріплених (бренд-фічі вмикаються назад).
     */
    private async settleReactivation(
        userId: string,
        orderReference: string,
        invoiceId: string,
        card: CardDetails,
        cardToken: string | null
    ): Promise<void> {
        const session = await this.connection.startSession();
        let applied = false;
        let detached: string[] = [];
        try {
            await session.withTransaction(async () => {
                const matched = await this.settlePaymentRecord(
                    orderReference,
                    PAYMENT_RECORD_STATUS.APPROVED,
                    invoiceId,
                    card,
                    session
                );
                if (!matched) return;
                const profile = await this.profileModel
                    .findOne({
                        userId: new Types.ObjectId(userId),
                        ...this.disabledByNonPaymentFilter(),
                    })
                    .session(session)
                    .lean();
                // Профіль уже не вимкнений: доступ повернуто іншим шляхом
                // (наприклад, звичайною купівлею, поки це списання було в
                // обробці банку). Гроші пройшли вдруге, застосувати їх нема до
                // чого — у ручний розбір, а не мовчки.
                if (!profile) {
                    this.logger.error(
                        `Reactivation ${orderReference} paid while profile is ` +
                            'no longer disabled — manual review'
                    );
                    await this.markSettledChargeUnmatched(
                        userId,
                        orderReference,
                        invoiceId,
                        session
                    );
                    return;
                }
                // Повернення відновлює склад, за який платник платив до
                // вимкнення, а не той, що лишився у живих полях від покинутої
                // нової купівлі. Знімок веде і суму цього списання.
                const composition = this.disabledComposition(profile);
                const fresh = this.freshCycleFields(
                    profile,
                    new Date(),
                    card,
                    cardToken,
                    this.restoreCompositionUpdates(composition)
                );
                const update: Record<string, unknown> = { $set: fresh.set };
                const addToSet: Record<string, unknown> = {};
                if (fresh.detached.length > 0) {
                    addToSet['pendingReconcileBusinessIds'] = {
                        $each: fresh.detached.map(
                            (id) => new Types.ObjectId(id)
                        ),
                    };
                }
                if (fresh.replacedToken) {
                    addToSet['pendingRevokeCardTokens'] = fresh.replacedToken;
                }
                if (Object.keys(addToSet).length > 0) {
                    update['$addToSet'] = addToSet;
                }
                await this.profileModel.updateOne(
                    {
                        userId: new Types.ObjectId(userId),
                        ...this.disabledByNonPaymentFilter(),
                    },
                    update,
                    { session }
                );
                await this.topUpToCapInTx(
                    userId,
                    this.effectiveComposition(composition).documentsTierSize,
                    `activation:${userId}:${fresh.periodEnd.getTime()}`,
                    session
                );
                applied = true;
                detached = fresh.detached;
            });
        } finally {
            await session.endSession();
        }
        if (applied) await this.reconcileAllAttached(userId, detached);
    }

    /**
     * Доводить завислу спробу повернення до фіналу: статус з події вебхука або
     * звіркою за invoiceId.
     */
    private async reconcileClaimedReactivation(
        userId: string,
        orderReference: string,
        known: BillingWebhookEvent | null = null
    ): Promise<void> {
        const record = await this.paymentRecordModel
            .findOne({
                orderReference,
                status: PAYMENT_RECORD_STATUS.PENDING,
            })
            .lean();
        if (!record) return;
        const event = await this.resolveClaimEvent(
            userId,
            orderReference,
            record,
            known
        );
        if (!event) return;
        if (this.isNonTerminal(event.status)) return;
        if (event.status === MONOBANK_INVOICE_STATUS.SUCCESS) {
            await this.settleReactivation(
                userId,
                orderReference,
                event.invoiceId,
                event,
                event.cardToken
            );
        } else {
            await this.settleImmediateDecline(
                userId,
                orderReference,
                event.invoiceId,
                event
            );
        }
    }

    // ── Immediate token charge (proration / credit pack) ─────────────────

    /**
     * Негайне списання за токеном. Повертає `true`, якщо результат нетермінальний
     * (ефект застосує billing-clock-reconcile за збереженим `pendingEffect`).
     * Термінальний success застосовує ефект синхронно; decline / not-applied —
     * кидає користувачу; transport-unknown — прапор ручного розбору + кидає,
     * а якщо гроші таки рухались, вебхук monobank добиває claim-запис
     * (`reconcileClaimedImmediate` з подією: бекфіл invoiceId → settle → ефект →
     * зняття прапора і повернення планувальника).
     */
    private async chargeImmediate(
        userId: string,
        orderReference: string,
        type: PaymentRecordType,
        amount: number,
        effect: PendingEffect,
        productName: string
    ): Promise<boolean> {
        const profile = await this.requireChargeableProfile(userId);
        return this.chargeSavedCard(userId, {
            cardToken: profile.cardToken!,
            orderReference,
            type,
            amount,
            currency: profile.currency ?? BILLING_CURRENCY,
            pendingEffect: effect,
            productName,
            label: 'Immediate charge',
            onSuccess: (result) =>
                this.settleImmediateSuccess(
                    userId,
                    orderReference,
                    result.invoiceId,
                    result
                ),
        });
    }

    /**
     * Спільний кістяк списання збереженою карткою, яке ініціює дія платника:
     * claim-first запис спроби → один виклик банку → розбір результату. Дії
     * (пропорція, докупівля кредитів, повернення після вимкнення доступу)
     * відрізняються лише реквізитами спроби і тим, що робити з успіхом, — а
     * money-safety у них одна, тож і код один. Дві копії цієї обробки означали
     * б, що виправлення в одній тихо не доїде до другої.
     *
     * Повертає `true`, якщо результат нетермінальний: фінал доведе вебхук або
     * clock-звірка завислого claim-запису.
     */
    private async chargeSavedCard(
        userId: string,
        input: {
            cardToken: string;
            orderReference: string;
            type: PaymentRecordType;
            amount: number;
            currency: string;
            pendingEffect: PendingEffect | null;
            productName: string;
            /** Префікс рядка логу — за ним видно, яка саме дія впала. */
            label: string;
            onSuccess: (result: ChargeResult) => Promise<void>;
        }
    ): Promise<boolean> {
        const { orderReference } = input;
        await this.claimAttempt(
            userId,
            orderReference,
            input.type,
            input.amount,
            input.currency,
            input.pendingEffect
        );

        let result: ChargeResult;
        try {
            result = await this.provider.chargeByToken({
                orderReference,
                cardToken: input.cardToken,
                amount: input.amount,
                currency: input.currency,
                productName: input.productName,
                serviceUrl: this.serviceUrl(),
            });
        } catch (error) {
            if (
                error instanceof ProviderRequestError &&
                error.chargeDefinitelyNotApplied
            ) {
                // Гроші точно не рухались — запис спроби звільняємо, щоб він не
                // блокував наступні платні дії (`assertNoUnsettledCharge`).
                await this.releaseClaim(orderReference);
                // Відмова саме за карткою (банк не знає токена або не прийняв
                // за ним рахунок) остаточна: повтор тією самою карткою дасть те
                // саме. Кажемо про це кодом відмови банку — кабінет веде на
                // заміну картки, а не пропонує зачекати і натиснути ще раз.
                if (isCardRefusal(error)) {
                    this.logger.warn(
                        `${input.label} refused by provider for ${orderReference}: ` +
                            error.message
                    );
                    throw new BadRequestException({
                        code: RESPONSE_CODE.BILLING_CHARGE_DECLINED,
                        message: 'Charge refused by bank',
                    });
                }
                // Решта (ліміт запитів, наша авторизація у банку) — тимчасове і
                // не про картку платника: тут повтор має сенс.
                throw new ConflictException({
                    code: RESPONSE_CODE.BILLING_OPERATION_IN_PROGRESS,
                    message: 'Charge rejected, retry',
                });
            }
            this.logger.error(
                `${input.label} transport failure for ${orderReference}`,
                error instanceof Error ? error.stack : String(error)
            );
            await this.flagManualReview(userId);
            throw new ConflictException({
                code: RESPONSE_CODE.BILLING_OPERATION_IN_PROGRESS,
                message: 'Charge result unknown, under review',
            });
        }

        await this.paymentRecordModel.updateOne(
            { orderReference, status: PAYMENT_RECORD_STATUS.PENDING },
            { $set: { providerTransactionId: result.invoiceId } }
        );

        if (this.isNonTerminal(result.status)) {
            // Рідкісний async: фінал доведе вебхук або clock-звірка.
            return true;
        }
        if (result.status === MONOBANK_INVOICE_STATUS.SUCCESS) {
            await input.onSuccess(result);
            return false;
        }
        // Термінальна відмова: гроші не взято, ефект не застосовуємо.
        await this.settleImmediateDecline(
            userId,
            orderReference,
            result.invoiceId,
            result
        );
        throw new BadRequestException({
            code: RESPONSE_CODE.BILLING_CHARGE_DECLINED,
            message: 'Charge declined by bank',
        });
    }

    /**
     * Термінальний success негайного списання: settle PENDING→APPROVED +
     * застосування збереженого ефекту (нова ємність + кредити) в одній
     * транзакції. Ідемпотентно через settle-matched-гейт.
     */
    private async settleImmediateSuccess(
        userId: string,
        orderReference: string,
        invoiceId: string,
        card: CardDetails
    ): Promise<void> {
        // Фільтр на PENDING обов'язковий двічі: (1) єдиний індекс на
        // orderReference — partial по status:pending, запит без статусу йшов би
        // collscan-ом по всій історії списань; (2) уже settle-нутий запис і так
        // відсіявся б гейтом settlePaymentRecord нижче — рання відсічка тут
        // еквівалентна і дешевша.
        const record = await this.paymentRecordModel
            .findOne({ orderReference, status: PAYMENT_RECORD_STATUS.PENDING })
            .lean();
        if (!record?.pendingEffect) return;
        const effect = record.pendingEffect as PendingEffect;
        const { businessIds, marker } = await this.applyEffectInTx(
            userId,
            orderReference,
            invoiceId,
            card,
            effect
        );
        const complete = await this.reconcileBusinessesSafe(businessIds);
        if (complete && marker) {
            await this.clearReconcileMarker(userId, marker);
        }
    }

    private async settleImmediateDecline(
        userId: string,
        orderReference: string,
        invoiceId: string,
        card: CardDetails
    ): Promise<void> {
        const session = await this.connection.startSession();
        try {
            await session.withTransaction(async () => {
                const matched = await this.settlePaymentRecord(
                    orderReference,
                    PAYMENT_RECORD_STATUS.DECLINED,
                    invoiceId,
                    card,
                    session
                );
                // Відмова — теж РОЗВ'ЯЗАНА невизначеність: гроші точно не
                // рухались, тож ops-прапор transport-unknown і вісь
                // планувальника повертаються (див. clearChargeUncertainty).
                if (matched) {
                    await this.clearChargeUncertainty(userId, session);
                }
            });
        } finally {
            await session.endSession();
        }
    }

    /**
     * Застосовує ефект (нова ємність складу + нарахування кредитів) атомарно з
     * settle PENDING→APPROVED. Повертає ПОВНИЙ реконсиляційний борг профілю
     * (`owedReconcileIds`) і durable-маркер (якщо ефект міняв прикріплення).
     * Ідемпотентність нарахування кредитів — unique `idempotencyKey` книги.
     */
    private async applyEffectInTx(
        userId: string,
        orderReference: string,
        invoiceId: string,
        card: CardDetails,
        effect: PendingEffect
    ): Promise<{ businessIds: string[]; marker: Date | null }> {
        const session = await this.connection.startSession();
        let outcome: { businessIds: string[]; marker: Date | null } = {
            businessIds: [],
            marker: null,
        };
        try {
            await session.withTransaction(async () => {
                const matched = await this.settlePaymentRecord(
                    orderReference,
                    PAYMENT_RECORD_STATUS.APPROVED,
                    invoiceId,
                    card,
                    session
                );
                if (!matched) return;
                outcome = await this.applyEffectFields(
                    userId,
                    orderReference,
                    effect,
                    session
                );
                // Settle розв'язав можливий transport-unknown цього списання:
                // знімаємо ops-прапор і повертаємо вісь планувальника.
                await this.clearChargeUncertainty(userId, session);
            });
        } finally {
            await session.endSession();
        }
        return outcome;
    }

    /**
     * Ставить нову ємність складу, атомарно прикріплює бізнес (якщо ефект з
     * прикріпленням) і нараховує кредити (в межах сесії). Нова ємність СКИДАЄ
     * заплановане зменшення цього всесвіту: інакше stale pending на межі циклу
     * зрізав би щойно оплачену ємність без повернення. При прикріпленні
     * стемпиться durable-маркер реконсиляції (транзієнтний збій добере
     * daily-sweep); caller знімає його після повного проходу.
     */
    private async applyEffectFields(
        userId: string,
        idempotencyKey: string,
        effect: PendingEffect,
        session: ClientSession
    ): Promise<{ businessIds: string[]; marker: Date | null }> {
        const set: Record<string, unknown> = {};
        if (effect.universe === BILLING_UNIVERSE.BRAND) {
            if (effect.targetCapacity !== null) {
                set['brand.capacity'] = effect.targetCapacity;
                set['brand.pendingCapacity'] = null;
                set['brand.pendingKeepBusinessIds'] = [];
            }
        } else if (effect.targetTierSize !== null) {
            set['documents.tierSize'] = effect.targetTierSize;
            set['documents.pendingTierSize'] = null;
            set['documents.pendingKeepBusinessIds'] = [];
        }
        const marker = effect.attachBusinessId ? new Date() : null;
        if (marker) set['reconcileRequiredAt'] = marker;

        const update: Record<string, unknown> = {};
        if (Object.keys(set).length > 0) update['$set'] = set;
        if (effect.attachBusinessId) {
            const field =
                effect.universe === BILLING_UNIVERSE.BRAND
                    ? 'brand.attachedBusinessIds'
                    : 'documents.attachedBusinessIds';
            update['$addToSet'] = {
                [field]: new Types.ObjectId(effect.attachBusinessId),
            };
        }
        if (Object.keys(update).length > 0) {
            await this.profileModel.updateOne(
                { userId: new Types.ObjectId(userId) },
                update,
                { session }
            );
        }
        if (effect.grantCredits > 0) {
            await this.grantCredits(
                userId,
                effect.grantCredits,
                CREDIT_LEDGER_ENTRY_TYPE.PURCHASE,
                idempotencyKey,
                idempotencyKey,
                session
            );
        }
        const profile = await this.profileModel
            .findOne({ userId: new Types.ObjectId(userId) })
            .session(session)
            .lean();
        // Повний борг профілю, не лише склад цього всесвіту: caller знімає
        // durable-маркер після проходу, а маркер один на профіль — вужчий
        // набір стирав би слід чужої незавершеної реконсиляції.
        return {
            businessIds: profile ? this.owedReconcileIds(profile) : [],
            marker,
        };
    }

    /** Пряме застосування ефекту без списання (крайній день циклу, charge=0). */
    private async applyEffectDirect(
        userId: string,
        effect: PendingEffect
    ): Promise<void> {
        // Ключ книги кредитів — глобально-унікальний простір (unique index), тож
        // userId + nonce, як у orderReference-ключах: wall-clock без userId
        // колізував би між платниками в одну мілісекунду, і другий grantCredits
        // тихо став би no-op. Поза транзакцією: transient-retry — той самий ключ.
        const idempotencyKey = `free:${userId}:${effect.universe}:${randomBytes(8).toString('hex')}`;
        const session = await this.connection.startSession();
        let outcome: { businessIds: string[]; marker: Date | null } = {
            businessIds: [],
            marker: null,
        };
        try {
            await session.withTransaction(async () => {
                outcome = await this.applyEffectFields(
                    userId,
                    idempotencyKey,
                    effect,
                    session
                );
            });
        } finally {
            await session.endSession();
        }
        const complete = await this.reconcileBusinessesSafe(
            outcome.businessIds
        );
        if (complete && outcome.marker) {
            await this.clearReconcileMarker(userId, outcome.marker);
        }
    }

    // ── Credit ledger ────────────────────────────────────────────────────

    /**
     * Append-only нарахування кредитів з ідемпотентністю за ключем. Дублікат
     * (той самий idempotencyKey) → no-op (баланс не подвоюється). Повертає
     * фактично нараховане (0 на дублі).
     */
    private async grantCredits(
        userId: string,
        credits: number,
        type: (typeof CREDIT_LEDGER_ENTRY_TYPE)[keyof typeof CREDIT_LEDGER_ENTRY_TYPE],
        idempotencyKey: string,
        paymentReference: string | null,
        session: ClientSession
    ): Promise<number> {
        const exists = await this.ledgerModel
            .findOne({ idempotencyKey })
            .session(session)
            .lean();
        if (exists) return 0;
        const profile = await this.profileModel
            .findOneAndUpdate(
                { userId: new Types.ObjectId(userId) },
                { $inc: { 'documents.credits.balance': credits } },
                { new: true, session }
            )
            .lean();
        const balanceAfter = profile?.documents.credits.balance ?? credits;
        await this.ledgerModel.create(
            [
                {
                    userId: new Types.ObjectId(userId),
                    type,
                    credits,
                    balanceAfter,
                    costUsdMicros: null,
                    paymentReference,
                    documentId: null,
                    idempotencyKey,
                },
            ],
            { session }
        );
        return credits;
    }

    /**
     * Top-up-to-cap: доганяє баланс до місячного обсягу пакета (лише вгору;
     * докуплені понад cap лишаються). Пише TOP_UP-рядок на різницю. Ідемпотентно
     * за ключем циклу.
     */
    private async topUpToCapInTx(
        userId: string,
        tierSize: number | null,
        cycleKey: string,
        session: ClientSession
    ): Promise<void> {
        if (tierSize === null) return;
        const cap = documentsMonthlyCredits(this.grid.documents, tierSize);
        const profile = await this.profileModel
            .findOne({ userId: new Types.ObjectId(userId) })
            .session(session)
            .lean();
        const balance = profile?.documents.credits.balance ?? 0;
        if (balance >= cap) return;
        const delta = cap - balance;
        await this.grantCredits(
            userId,
            delta,
            CREDIT_LEDGER_ENTRY_TYPE.TOP_UP,
            `topup:${cycleKey}`,
            null,
            session
        );
    }

    // ── Billing clock: cycle charge ──────────────────────────────────────

    async chargeDueCycle(userId: string): Promise<void> {
        await this.withBillingLock(userId, () =>
            this.chargeDueCycleLocked(userId)
        );
    }

    /**
     * `countsAsDunningAttempt: false` — списання ініціював сам платник заміною
     * картки, а не розклад. Його відмова не наближає вимкнення доступу і не
     * зсуває наступну планову спробу: інакше заміна картки на останньому дні
     * прострочки вимикала б доступ миттєво.
     */
    private async chargeDueCycleLocked(
        userId: string,
        { countsAsDunningAttempt }: { countsAsDunningAttempt: boolean } = {
            countsAsDunningAttempt: true,
        }
    ): Promise<void> {
        const profile = await this.getProfile(userId);
        if (
            !profile ||
            profile.cancelAtPeriodEnd ||
            // Sprint 31 — пауза вікна відновлення акаунта. Планувальник уже
            // відфільтрував її у своїй вибірці, але між тією вибіркою і цим
            // списанням проходить увесь батч (на кожного платника — звернення до
            // monobank), і підтвердження видалення цілком може встигнути
            // вклинитись. Тоді застарілий список зняв би плату за вже вимкнений
            // сервіс без жодного шляху повернути гроші. Свіже слово — за
            // профілем під локом, як і решта перевірок нижче.
            profile.billingPausedAt ||
            !profile.cardToken ||
            !profile.currentPeriodEnd ||
            (profile.status !== SUBSCRIPTION_STATUS.ACTIVE &&
                profile.status !== SUBSCRIPTION_STATUS.PAST_DUE)
        ) {
            return;
        }
        // Профіль без користувача (hard-delete не догасив білінг, або крах між
        // ретайром і видаленням) — гасимо замість списувати картку неіснуючого
        // акаунта далі. Backstop до ретайру у CleanupService.
        const owner = await this.usersService.findById(userId);
        if (!owner) {
            this.logger.warn(
                `Billing profile of user ${userId} has no user document — retiring`
            );
            await this.retireEmptyProfile(userId, profile);
            return;
        }
        // Сума — за ЕФЕКТИВНИМ складом наступного циклу: заплановані зменшення
        // діють з цього списання (advanceCycle застосує їх на success), інакше
        // користувач заплатив би ще один місяць за стару (більшу) ємність.
        const amount = this.effectiveMonthlyAmount(profile);
        if (amount <= 0) {
            // Ефективний склад порожній (усе зменшено до нуля) — застосовуємо
            // відкладені зменшення і гасимо профіль без списання.
            await this.retireEmptyProfile(userId, profile);
            return;
        }
        const boundary = profile.currentPeriodEnd;
        const orderReference = buildCycleOrderReference(userId, boundary);
        const currency = profile.currency ?? BILLING_CURRENCY;

        const claim = await this.claimAttempt(
            userId,
            orderReference,
            PAYMENT_RECORD_TYPE.CYCLE,
            amount,
            currency,
            null,
            countsAsDunningAttempt
        );
        if (claim === 'exists') {
            await this.reconcileClaimedCycle(userId, orderReference);
            return;
        }

        let result: ChargeResult;
        try {
            result = await this.provider.chargeByToken({
                orderReference,
                cardToken: profile.cardToken,
                amount,
                currency,
                productName: 'Місячне списання Finly',
                serviceUrl: this.serviceUrl(),
            });
        } catch (error) {
            if (
                error instanceof ProviderRequestError &&
                error.chargeDefinitelyNotApplied
            ) {
                await this.releaseClaim(orderReference);
                return;
            }
            this.logger.error(
                `Cycle charge transport failure for ${orderReference}`,
                error instanceof Error ? error.stack : String(error)
            );
            await this.flagManualReview(userId);
            return;
        }

        await this.paymentRecordModel.updateOne(
            { orderReference, status: PAYMENT_RECORD_STATUS.PENDING },
            { $set: { providerTransactionId: result.invoiceId } }
        );
        if (this.isNonTerminal(result.status)) return;
        await this.finalizeCycleTerminal(userId, orderReference, boundary, {
            currency,
            status: result.status,
            invoiceId: result.invoiceId,
            card: result,
            cardToken: result.cardToken,
        });
    }

    /**
     * billing-clock reconcile: доводить будь-який завислий PENDING-запис до
     * фіналу за його типом — цикловий (від межі періоду) або негайний
     * (пропорція/докупівля, застосування збереженого ефекту).
     */
    async finalizePending(
        userId: string,
        orderReference: string
    ): Promise<void> {
        await this.withBillingLock(userId, async () => {
            const record = await this.paymentRecordModel
                .findOne({
                    orderReference,
                    status: PAYMENT_RECORD_STATUS.PENDING,
                })
                .lean();
            if (!record) return;
            // Маршрутизуємо за видом операції з самого ідентифікатора, а не за
            // типом запису: повернення після вимкнення теж пишеться типом
            // CYCLE, але його межу з ідентифікатора не відновити, і цикловий
            // шлях вийшов би мовчки, лишивши спробу завислою назавжди.
            const kind = parseOrderReference(orderReference)?.kind;
            if (kind === ORDER_KIND.REACTIVATION) {
                await this.reconcileClaimedReactivation(userId, orderReference);
            } else if (kind === ORDER_KIND.CYCLE) {
                await this.reconcileClaimedCycle(userId, orderReference);
            } else {
                await this.reconcileClaimedImmediate(userId, orderReference);
            }
        });
    }

    /**
     * Джерело термінального статусу для звірки claim-запису: подія вебхука
     * (`known`, якщо тригер — вебхук) або запит статусу за збереженим invoiceId.
     * Вебхук заразом бекфілить invoiceId у запис, коли синхронне списання впало
     * transport-unknown ДО його збереження: без бекфілу такий PENDING назавжди
     * випадав би з clock-звірки (її фільтр вимагає invoiceId), а результат,
     * який вебхук уже приніс, викидався б — оплачений ефект ніколи не
     * застосувався б.
     */
    private async resolveClaimEvent(
        userId: string,
        orderReference: string,
        record: PaymentRecordLean,
        known: BillingWebhookEvent | null
    ): Promise<BillingWebhookEvent | null> {
        if (known) {
            if (!record.providerTransactionId) {
                await this.paymentRecordModel.updateOne(
                    { orderReference, status: PAYMENT_RECORD_STATUS.PENDING },
                    { $set: { providerTransactionId: known.invoiceId } }
                );
            }
            return known;
        }
        if (!record.providerTransactionId) {
            this.logger.error(
                `Claim ${orderReference} stuck without invoiceId — manual review`
            );
            await this.flagManualReview(userId);
            return null;
        }
        try {
            return await this.provider.getInvoiceStatus(
                record.providerTransactionId,
                orderReference
            );
        } catch (error) {
            this.logger.warn(
                `getInvoiceStatus failed for ${orderReference}: ` +
                    (error instanceof Error ? error.message : String(error))
            );
            return null;
        }
    }

    /**
     * Доводить завислий негайний PENDING (пропорція/докупівля) до фіналу:
     * статус з події вебхука (`known`) або звіркою за invoiceId.
     */
    private async reconcileClaimedImmediate(
        userId: string,
        orderReference: string,
        known: BillingWebhookEvent | null = null
    ): Promise<void> {
        const record = await this.paymentRecordModel
            .findOne({
                orderReference,
                status: PAYMENT_RECORD_STATUS.PENDING,
            })
            .lean();
        if (!record) return;
        const event = await this.resolveClaimEvent(
            userId,
            orderReference,
            record,
            known
        );
        if (!event) return;
        if (this.isNonTerminal(event.status)) return;
        if (event.status === MONOBANK_INVOICE_STATUS.SUCCESS) {
            await this.settleImmediateSuccess(
                userId,
                orderReference,
                event.invoiceId,
                event
            );
        } else {
            await this.settleImmediateDecline(
                userId,
                orderReference,
                event.invoiceId,
                event
            );
        }
    }

    private async reconcileClaimedCycle(
        userId: string,
        orderReference: string,
        known: BillingWebhookEvent | null = null
    ): Promise<void> {
        const record = await this.paymentRecordModel
            .findOne({
                orderReference,
                status: PAYMENT_RECORD_STATUS.PENDING,
            })
            .lean();
        if (!record) return;
        const boundary = cycleBoundaryFromRef(orderReference);
        if (!boundary) return;
        const profile = await this.getProfile(userId);
        if (!profile) return;
        const currency = profile.currency ?? BILLING_CURRENCY;
        const event = await this.resolveClaimEvent(
            userId,
            orderReference,
            record,
            known
        );
        if (!event) return;
        await this.finalizeCycleTerminal(userId, orderReference, boundary, {
            currency,
            status: event.status,
            invoiceId: event.invoiceId,
            card: event,
            cardToken: event.cardToken,
        });
    }

    private async finalizeCycleTerminal(
        userId: string,
        orderReference: string,
        boundary: Date,
        ctx: {
            currency: string;
            status: string;
            invoiceId: string;
            card: CardDetails;
            cardToken: string | null;
        }
    ): Promise<void> {
        if (this.isNonTerminal(ctx.status)) return;
        const user = await this.usersService.findById(userId);
        const email = user?.email ?? '';

        if (ctx.status === MONOBANK_INVOICE_STATUS.SUCCESS) {
            const applied = await this.commitCycleSuccess(
                userId,
                orderReference,
                boundary,
                ctx.invoiceId,
                ctx.card,
                ctx.cardToken
            );
            if (applied) {
                if (applied.detached.length > 0) {
                    // advanceCycle стемпнув durable-маркер + detached-список у
                    // TX; повний прохід тут його знімає (attached — дешевий
                    // ідемпотентний no-op), інакше добере daily-sweep.
                    await this.reconcileAllAttached(userId, applied.detached);
                }
                this.logger.log(`Cycle renewed for user ${userId}`);
            }
            return;
        }

        const dunning = await this.commitCycleDecline(
            userId,
            orderReference,
            boundary,
            ctx.invoiceId,
            ctx.card
        );
        if (!dunning) return;
        if (dunning.exhausted) {
            await this.reconcileAllAttached(userId);
            await this.sendBillingEmailSafe(() =>
                this.emailService.sendSubscriptionEnded({
                    email,
                    planName: 'Finly',
                })
            );
        } else {
            // Сума лише для past-due листа; профіль тут щойно PAST_DUE
            // (entitled), тож склад гарантовано прайситься чинною сіткою.
            const profile = await this.getProfile(userId);
            const monthly = profile ? this.effectiveMonthlyAmount(profile) : 0;
            await this.sendBillingEmailSafe(() =>
                this.emailService.sendSubscriptionPastDue({
                    email,
                    planName: 'Finly',
                    amount: monthly,
                    currency: ctx.currency,
                    attempt: dunning.attempts,
                    maxAttempts: BILLING_DUNNING.maxAttempts,
                })
            );
        }
    }

    /**
     * Атомарно: settle PENDING→APPROVED + просування періоду + застосування
     * відкладених зменшень + top-up-to-cap. Повертає detached businessIds (для
     * реконсиляції) або null, якщо нічого не застосовано: запис спроби закрито
     * раніше або гроші пішли в ручний розбір.
     */
    private async commitCycleSuccess(
        userId: string,
        orderReference: string,
        boundary: Date,
        invoiceId: string,
        card: CardDetails,
        cardToken: string | null
    ): Promise<{ detached: string[] } | null> {
        const session = await this.connection.startSession();
        try {
            let outcome: { detached: string[] } | null = null;
            await session.withTransaction(async () => {
                const matched = await this.settlePaymentRecord(
                    orderReference,
                    PAYMENT_RECORD_STATUS.APPROVED,
                    invoiceId,
                    card,
                    session
                );
                if (!matched) return;
                const detached = await this.advanceCycle(
                    userId,
                    boundary,
                    card,
                    cardToken,
                    session
                );
                // Запис спроби щойно закрито як успішний, а місяць уже закрито
                // іншим шляхом (наприклад, «Оплатити зараз», поки ця спроба
                // була в обробці банку). Це другі гроші за той самий місяць:
                // зсунути цикл удруге не можна, мовчки зарахувати теж.
                if (detached === null) {
                    this.logger.error(
                        `Cycle charge ${orderReference} paid for an already ` +
                            'closed period — manual review'
                    );
                    await this.markSettledChargeUnmatched(
                        userId,
                        orderReference,
                        invoiceId,
                        session
                    );
                    return;
                }
                outcome = { detached };
            });
            return outcome;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Просуває цикл на місяць від межі (без дрейфу), застосовує відкладені
     * зменшення ємності (з трим прикріплень), робить top-up-to-cap кредитів,
     * скидає dunning. Фільтр на `currentPeriodEnd === boundary` — ідемпотентність.
     * `null` — межу вже закрито: цикл удруге не просувається, а caller вирішує,
     * що робити з грошима, які прийшли за закритий місяць.
     */
    private async advanceCycle(
        userId: string,
        boundary: Date,
        card: CardDetails,
        cardToken: string | null,
        session: ClientSession
    ): Promise<string[] | null> {
        const profile = await this.profileModel
            .findOne({
                userId: new Types.ObjectId(userId),
                currentPeriodEnd: boundary,
            })
            .session(session)
            .lean();
        if (!profile) return null;

        const { set, detached } = this.pendingDecreaseUpdates(profile);

        // Межа — від якір-дня, НЕ від попередньої межі: інакше після короткого
        // місяця (31 січ → 28 лют) день списання застряг би на 28 назавжди.
        // Fallback на день межі — лише для legacy-профілів без anchorDay
        // (та сама поведінка, що була до появи якоря).
        const newPeriodEnd = nextCycleBoundary(
            boundary,
            profile.anchorDay ?? boundary.getDate()
        );
        set['status'] = SUBSCRIPTION_STATUS.ACTIVE;
        set['currentPeriodStart'] = boundary;
        set['currentPeriodEnd'] = newPeriodEnd;
        set['nextChargeAt'] = newPeriodEnd;
        set['dunningAttempts'] = 0;
        set['nextRetryAt'] = null;
        // Профіль ожив: і точка відліку строку зберігання картки, і знімок
        // складу вимкненого профілю більше нічого не описують.
        Object.assign(set, this.clearDisabledStateFields());
        set['needsManualReview'] = false;
        set['lastProviderEventAt'] = new Date();
        // Оплата прострочки зі сторінки банку могла прийти з іншою карткою.
        const paidCard = this.paidCardUpdates(
            profile.cardToken,
            card,
            cardToken
        );
        Object.assign(set, paidCard.set);

        const update: Record<string, unknown> = { $set: set };
        const addToSet: Record<string, unknown> = {};
        if (detached.length > 0) {
            // Маркер + detached-список атомарно з тримом прикріплень: caller
            // реконсилює detached після коміту, але без durable-сліду крах у
            // цьому вікні лишив би відкріплений бізнес із brandedAt (бренд
            // безкоштовно) назавжди — у складах його вже немає, sweep по
            // прикріплених його не бачить.
            set['reconcileRequiredAt'] = new Date();
            addToSet['pendingReconcileBusinessIds'] = {
                $each: detached.map((id) => new Types.ObjectId(id)),
            };
        }
        if (paidCard.replacedToken) {
            addToSet['pendingRevokeCardTokens'] = paidCard.replacedToken;
        }
        if (Object.keys(addToSet).length > 0) update['$addToSet'] = addToSet;
        await this.profileModel.updateOne(
            { userId: new Types.ObjectId(userId), currentPeriodEnd: boundary },
            update,
            { session }
        );

        // top-up-to-cap за НОВИМ пакетом документів (після можливого зменшення).
        await this.topUpToCapInTx(
            userId,
            this.effectiveComposition(profile).documentsTierSize,
            `${userId}:${newPeriodEnd.getTime()}`,
            session
        );

        return detached;
    }

    /**
     * $set-фрагмент застосування відкладених зменшень: нова ємність / пакет,
     * трим прикріплень (спершу явно обрані `pendingKeep*`), чистка pending-полів.
     * Повертає також businessId-и, що відкріпились (їм потрібна реконсиляція).
     */
    private pendingDecreaseUpdates(profile: Composition): CompositionUpdates {
        const set: Record<string, unknown> = {};
        const detached: string[] = [];

        if (profile.brand.pendingCapacity !== null) {
            const { keptIds, detachedIds } = this.applyDecrease(
                profile.brand.attachedBusinessIds,
                profile.brand.pendingKeepBusinessIds,
                profile.brand.pendingCapacity
            );
            set['brand.capacity'] = profile.brand.pendingCapacity;
            set['brand.attachedBusinessIds'] = keptIds;
            set['brand.pendingCapacity'] = null;
            set['brand.pendingKeepBusinessIds'] = [];
            detached.push(...detachedIds.map((id) => id.toString()));
        }
        if (profile.documents.pendingTierSize !== null) {
            const newSize =
                profile.documents.pendingTierSize === 0
                    ? null
                    : profile.documents.pendingTierSize;
            const { keptIds, detachedIds } = this.applyDecrease(
                profile.documents.attachedBusinessIds,
                profile.documents.pendingKeepBusinessIds,
                newSize ?? 0
            );
            set['documents.tierSize'] = newSize;
            set['documents.attachedBusinessIds'] = keptIds;
            set['documents.pendingTierSize'] = null;
            set['documents.pendingKeepBusinessIds'] = [];
            detached.push(...detachedIds.map((id) => id.toString()));
        }
        return { set, detached };
    }

    /**
     * Гасіння профілю без списання: межа циклу з порожнім ефективним складом,
     * профіль-сирота без user-документа АБО скасований профіль з простроченим
     * періодом на повторному checkout (не чекаємо cron-згасання). Застосовує
     * відкладені зменшення, ставить CANCELED і реконсилює всі раніше прикріплені
     * бізнеси (бренд-фічі гаснуть). Durable-маркер тримає retry реконсиляції
     * при транзієнтному збої.
     */
    private async retireEmptyProfile(
        userId: string,
        profile: BillingProfileLean
    ): Promise<void> {
        // Повний борг (обидва склади + durable-список detached від попередніх
        // збоїв): зняття маркера нижче легітимне лише після проходу по всьому.
        const previouslyAttached = this.owedReconcileIds(profile);
        const { set, detached } = this.pendingDecreaseUpdates(profile);
        const marker = new Date();
        const update: Record<string, unknown> = {
            $set: {
                ...set,
                status: SUBSCRIPTION_STATUS.CANCELED,
                nextChargeAt: null,
                nextRetryAt: null,
                // Підписка завершилась рішенням самого платника (скасування,
                // зменшення складу до нуля) або зникненням акаунта — картку
                // забуваємо повністю. Відкликання у гаманці банку йде з черги
                // фоновим проходом, а не тут: ця дія вже тримає лок разом з
                // іншим викликом провайдера (checkout), і другий виклик під ним
                // лише з'їдав би бюджет TTL.
                ...this.forgetCardFields(),
                // Профіль погас назавжди — стан «вимкнено несплатою» разом з
                // ним: повертатись збереженою карткою вже нікуди.
                ...this.clearDisabledStateFields(),
                reconcileRequiredAt: marker,
            },
        };
        const addToSet: Record<string, unknown> = {};
        if (detached.length > 0) {
            // Тримнуті відкладеним зменшенням зникають зі складів цим же
            // update-ом — durable-список тримає їх видимими для sweep, якщо
            // реконсиляція нижче не добіжить.
            addToSet['pendingReconcileBusinessIds'] = {
                $each: detached.map((id) => new Types.ObjectId(id)),
            };
        }
        if (profile.cardToken) {
            addToSet['pendingRevokeCardTokens'] = profile.cardToken;
        }
        if (Object.keys(addToSet).length > 0) update['$addToSet'] = addToSet;
        await this.profileModel.updateOne(
            { userId: new Types.ObjectId(userId) },
            update
        );
        const complete = await this.reconcileBusinessesSafe(previouslyAttached);
        if (complete) await this.clearReconcileMarker(userId, marker);
    }

    private applyDecrease(
        attached: Types.ObjectId[],
        keep: Types.ObjectId[],
        newCapacity: number
    ): { keptIds: Types.ObjectId[]; detachedIds: Types.ObjectId[] } {
        const keepSet = new Set(keep.map((id) => id.toString()));
        // Спершу явно обрані, далі найперші за порядком прикріплення — до ліміту.
        const ordered = [
            ...attached.filter((id) => keepSet.has(id.toString())),
            ...attached.filter((id) => !keepSet.has(id.toString())),
        ];
        const keptIds = ordered.slice(0, Math.max(0, newCapacity));
        const keptSet = new Set(keptIds.map((id) => id.toString()));
        const detachedIds = attached.filter(
            (id) => !keptSet.has(id.toString())
        );
        return { keptIds, detachedIds };
    }

    /**
     * Відмова циклового списання: запис спроби закривається завжди, а
     * прострочка рахується лише тоді, коли межа, за яку йшло списання, досі
     * відкрита. `null` — прострочку не зачеплено (відмова після заміни картки
     * або за вже закритий місяць), листа про прострочку немає.
     */
    private async commitCycleDecline(
        userId: string,
        orderReference: string,
        boundary: Date,
        invoiceId: string,
        card: CardDetails
    ): Promise<{ exhausted: boolean; attempts: number } | null> {
        const session = await this.connection.startSession();
        try {
            let outcome: { exhausted: boolean; attempts: number } | null = null;
            await session.withTransaction(async () => {
                const record = await this.paymentRecordModel
                    .findOne({
                        orderReference,
                        status: PAYMENT_RECORD_STATUS.PENDING,
                    })
                    .session(session)
                    .lean();
                const matched = await this.settlePaymentRecord(
                    orderReference,
                    PAYMENT_RECORD_STATUS.DECLINED,
                    invoiceId,
                    card,
                    session
                );
                if (!matched) return;
                // Відмова списання, яке ініціював сам платник: запис спроби
                // закрито, ops-прапор знято, а лічильник, розклад повторів і
                // статус лишаються як були, листа про прострочку теж немає
                // (outcome лишається null). Відсутнє поле у старих записах —
                // планова спроба.
                if (record?.countsAsDunningAttempt === false) {
                    await this.clearChargeUncertainty(userId, session);
                    return;
                }
                const profile = await this.profileModel
                    .findOne({
                        userId: new Types.ObjectId(userId),
                        currentPeriodEnd: boundary,
                    })
                    .session(session)
                    .lean();
                // Місяць, за який ішло списання, уже закрито іншим шляхом
                // («Оплатити зараз», поки ця спроба була в обробці банку).
                // Відмова за оплачений місяць нічого не винна: без цієї
                // перевірки вона повернула б оплаченому профілю прострочку, а
                // наступна спроба списала б гроші за НАСТУПНИЙ місяць завчасно
                // і за чергових відмов вимкнула б доступ тому, хто заплатив.
                if (!profile) {
                    this.logger.warn(
                        `Cycle charge ${orderReference} declined for an ` +
                            'already closed period — dunning untouched'
                    );
                    await this.clearChargeUncertainty(userId, session);
                    return;
                }
                const attempts = profile.dunningAttempts + 1;
                const exhausted = attempts >= BILLING_DUNNING.maxAttempts;
                // Decline — визначений результат: якщо цю спробу супроводжував
                // transport-unknown прапор, він знімається (дунінг сам веде
                // профіль далі через nextRetryAt / термінальний UNPAID).
                // Запис під тією ж умовою межі, що й читання вище.
                const openCycle = {
                    userId: new Types.ObjectId(userId),
                    currentPeriodEnd: boundary,
                };
                if (exhausted) {
                    await this.profileModel.updateOne(
                        openCycle,
                        {
                            $set: {
                                status: SUBSCRIPTION_STATUS.UNPAID,
                                dunningAttempts: attempts,
                                nextChargeAt: null,
                                nextRetryAt: null,
                                // Картка ЛИШАЄТЬСЯ: рішення піти платник не
                                // приймав, його вибило несплатою. Стемп —
                                // точка відліку строку зберігання, після
                                // якого картку стирає фонова чистка.
                                dunningExhaustedAt: new Date(),
                                // Склад фіксуємо тут, поки живі поля ще
                                // означають «за що платник платив»: після
                                // вимкнення їх перезапише перший же checkout
                                // (навіть покинутий), і повернення збереженою
                                // карткою оплатило б не той склад.
                                disabledSnapshot:
                                    this.compositionSnapshot(profile),
                                needsManualReview: false,
                                // Флип доступу (entitled → UNPAID) стемпить
                                // durable-маркер атомарно: реконсиляцію робить
                                // caller (reconcileAllAttached), але крах у
                                // вікні між TX і нею інакше лишив би
                                // прикріплені бізнеси брендованими без
                                // retry-тригера.
                                reconcileRequiredAt: new Date(),
                            },
                        },
                        { session }
                    );
                } else {
                    // Рівно на тик клока: між його тиком і цим записом минають
                    // секунди обробки, тож точний `now + інтервал` лежав би на
                    // кілька секунд ПОЗА сіткою, тик тієї ж години його не брав
                    // би, і кожна спроба зсувалась би на годину вперед.
                    const nextRetryAt = alignToClockTick(
                        new Date(
                            Date.now() +
                                BILLING_DUNNING.retryIntervalHours * 3_600_000
                        )
                    );
                    await this.profileModel.updateOne(
                        openCycle,
                        {
                            $set: {
                                status: SUBSCRIPTION_STATUS.PAST_DUE,
                                dunningAttempts: attempts,
                                nextChargeAt: null,
                                nextRetryAt,
                                needsManualReview: false,
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

    // ── Webhook ──────────────────────────────────────────────────────────

    async handleWebhook(
        rawBody: Buffer,
        signature: string | undefined
    ): Promise<boolean> {
        const { event } = await this.provider.parseWebhook(rawBody, signature);
        if (!event) return true;
        const parsed = parseOrderReference(event.orderReference);
        if (!parsed) return true;
        const afterLock: AfterLockTask[] = [];
        try {
            return await this.withBillingLock(parsed.userId, () =>
                this.routeTransaction(event, parsed, afterLock)
            );
        } catch (error) {
            if (isBillingLockBusy(error)) return false;
            this.logger.error(
                `Failed to process webhook ${event.providerEventId}`,
                error instanceof Error ? error.stack : String(error)
            );
            return false;
        } finally {
            // Ефекти ставляться в чергу лише після коміту запису, тож виконати
            // їх безпечно навіть тоді, коли решта обробки впала.
            await this.runAfterLock(afterLock);
        }
    }

    private async routeTransaction(
        event: BillingWebhookEvent,
        parsed: ParsedOrderReference,
        afterLock: AfterLockTask[]
    ): Promise<boolean> {
        const insert = await this.insertWebhookEvent(event, parsed.userId);
        if (insert === 'applied') {
            await this.backfillCardToken(event, parsed.userId);
            return true;
        }
        if (insert === 'pending') return false;

        // Прив'язка картки — ПЕРША гілка, до всього, що звіряє суми. Її рахунок
        // приходить із сумою нуль, і будь-яка перевірка «сплачено стільки ж,
        // скільки коштує склад» відправила б його у ручний розбір або, гірше,
        // дала б підстави чіпати підписку. Тут же гілка не має жодного шляху
        // активувати профіль, зрушити цикл чи нарахувати кредити.
        if (isCardVerifyKind(parsed.kind)) {
            await this.applyCardVerification(event, parsed, afterLock);
            return true;
        }

        if (parsed.kind === ORDER_KIND.CHECKOUT) {
            let detached: string[] = [];
            await this.applyInWebhookTx(event, async (session) => {
                detached = await this.applyCheckoutActivation(
                    event,
                    parsed.userId,
                    session
                );
            });
            // Відкріплені активацією (застосоване відкладене зменшення) теж
            // мусять реконсилюватись — їх уже немає у складах профілю.
            await this.reconcileAllAttached(parsed.userId, detached);
            // Оплата могла прийти з іншою карткою і поставити попередню в
            // чергу відкликання — відкликаємо одразу, а не фоновим проходом.
            afterLock.push(() => this.revokeQueuedCardTokensOf(parsed.userId));
            return true;
        }

        // CYCLE / negайне: синхронний результат — основний шлях; вебхук лише
        // ack (flip pending→applied) + прискорена фіналізація завислого PENDING.
        // Подія передається у звірку ПЕРШОДЖЕРЕЛОМ: якщо синхронне списання
        // впало transport-unknown до запису invoiceId, тільки вона може добити
        // claim-запис (clock-звірка такий запис не бачить — її фільтр вимагає
        // invoiceId). Ми вже під per-user локом (handleWebhook), тож
        // reconcileClaimed* без ре-локу.
        await this.applyInWebhookTx(event, () => Promise.resolve());
        if (parsed.kind === ORDER_KIND.CYCLE) {
            await this.reconcileClaimedCycle(
                parsed.userId,
                event.orderReference,
                event
            );
        } else if (parsed.kind === ORDER_KIND.REACTIVATION) {
            await this.reconcileClaimedReactivation(
                parsed.userId,
                event.orderReference,
                event
            );
        } else {
            await this.reconcileClaimedImmediate(
                parsed.userId,
                event.orderReference,
                event
            );
        }
        return true;
    }

    /**
     * Результат прив'язки картки. Пише ВИКЛЮЧНО поля картки (плюс відкликання
     * наміру не поновлювати, якщо прив'язка була заради відновлення) і не має
     * жодного шляху активувати профіль, зрушити цикл чи нарахувати кредити.
     *
     * Стара картка стає в чергу відкликання тим самим записом, що зберігає
     * нову, а сам запит до банку і лист ідуть у `afterLock`: стан підписки
     * вони не змінюють, а під локом лише з'їдали б бюджет TTL поруч зі
     * списанням боргу. Зворотний порядок (спершу банк) лишав би платника з
     * токеном, який банк уже не приймає, якби запис упав.
     */
    private async applyCardVerification(
        event: BillingWebhookEvent,
        parsed: ParsedOrderReference,
        afterLock: AfterLockTask[]
    ): Promise<void> {
        const userId = parsed.userId;
        // Проміжний статус (банк ще обробляє) нічого не змінює, але подію все
        // одно закриваємо як оброблену, як і решта гілок. Лишена «в роботі»,
        // вона виглядала б для фонової чистки як обробка, що впала посередині,
        // а її повторна доставка отримала б відмову замість підтвердження.
        if (this.isNonTerminal(event.status)) {
            await this.applyInWebhookTx(event, () => Promise.resolve());
            return;
        }
        if (
            event.status !== MONOBANK_INVOICE_STATUS.SUCCESS ||
            !event.cardToken
        ) {
            // Банк відхилив або рахунок сплив: стара картка лишається чинною.
            // Результат фіксуємо, щоб сторінка повернення з банку сказала
            // платнику, що прив'язати не вдалось.
            this.logger.warn(
                `Card verification ${event.orderReference} did not save a card ` +
                    `(status ${event.status})`
            );
            await this.applyInWebhookTx(event, (session) =>
                this.markCardVerification(
                    userId,
                    event.orderReference,
                    CARD_VERIFICATION_STATUS.FAILED,
                    session
                )
            );
            return;
        }

        const newToken = event.cardToken;
        const before = await this.getProfile(userId);
        if (!before) {
            // Профілю вже немає (акаунт остаточно видалено, поки платник був
            // на сторінці банку): зберігати картку нікуди. Подію закриваємо, а
            // токен, який банк уже поклав у гаманець, відкликаємо одразу —
            // черги відкликань без профілю немає, тож повтору не буде і
            // невдача лишиться лише в лозі.
            this.logger.warn(
                `Card verification ${event.orderReference} succeeded for user ` +
                    `${userId} without billing profile — revoking the token`
            );
            await this.applyInWebhookTx(event, () => Promise.resolve());
            afterLock.push(async () => {
                await this.deleteCardTokenAtProvider(userId, newToken);
            });
            return;
        }
        // Повторна прив'язка тієї самої картки може повернути той самий токен:
        // тоді відкликати нічого.
        const replacedToken =
            before.cardToken && before.cardToken !== newToken
                ? before.cardToken
                : null;

        // Порядок зважуємо лише серед прив'язок картки, за часом банку.
        // Спільна перевірка порядку подій (`lastProviderEventAt`) тут не
        // годиться: вона зіставляє рахунки різних видів, і списання, що
        // пройшло, поки це сповіщення чекало своєї черги, відкидало б картку,
        // яку банк уже зберіг. Від повторної доставки тієї самої події захищає
        // журнал оброблених подій.
        const verifiedAt = event.occurredAt;
        let applied = false;
        await this.applyInWebhookTx(event, async (session) => {
            const set: Record<string, unknown> = {
                cardToken: newToken,
                cardVerifiedAt: verifiedAt,
                // Спершу гасимо поля показу, і лише потім кладемо те, що
                // приніс банк: це ЗАМІНА картки, а не оновлення тієї самої.
                // `paymentInfo` приходить не повним, і без скидання відсутнє
                // значення лишило б у профілі банк чи маску старої картки
                // поруч із токеном нової (див. `blankCardFields`).
                ...blankCardFields(),
                ...cardProfileFields(event),
            };
            const update: Record<string, unknown> = { $set: set };
            if (replacedToken) {
                update['$addToSet'] = {
                    pendingRevokeCardTokens: replacedToken,
                };
            }
            const result = await this.profileModel.updateOne(
                {
                    userId: new Types.ObjectId(userId),
                    $or: [
                        { cardVerifiedAt: null },
                        { cardVerifiedAt: { $lt: verifiedAt } },
                    ],
                },
                update,
                { session, maxTimeMS: WEBHOOK_MONGO_TIMEOUT_MS }
            );
            applied = result.matchedCount === 1;
            if (!applied) {
                // Новіша прив'язка вже збережена. Цю картку банк однаково
                // поклав у гаманець, тож її токен іде в чергу відкликання, якщо
                // тільки це не та сама картка, що вже чинна.
                await this.profileModel.updateOne(
                    {
                        userId: new Types.ObjectId(userId),
                        cardToken: { $ne: newToken },
                    },
                    { $addToSet: { pendingRevokeCardTokens: newToken } },
                    { session }
                );
            }
            // Відновлення — окремим записом і лише коли картку справді
            // збережено: умови відновлення звіряються з ЖИВИМ станом профілю,
            // бо між походом на сторінку банку і цим моментом міг пройти
            // цілий сеанс платника (див. `renewAfterCardSaved`).
            if (applied && parsed.kind === ORDER_KIND.CARD_VERIFY_RENEW) {
                await this.renewAfterCardSaved(userId, before, session);
            }
            await this.markCardVerification(
                userId,
                event.orderReference,
                applied
                    ? CARD_VERIFICATION_STATUS.SAVED
                    : CARD_VERIFICATION_STATUS.FAILED,
                session
            );
        });
        if (!applied) {
            this.logger.warn(
                `Card verification ${event.orderReference} is older than the ` +
                    'saved card — token queued for revocation'
            );
            afterLock.push(() => this.revokeQueuedCardToken(userId, newToken));
            return;
        }
        if (replacedToken) {
            afterLock.push(() =>
                this.revokeQueuedCardToken(userId, replacedToken)
            );
        }
        const cardMask = event.cardMask;
        afterLock.push(() => this.notifyCardChanged(userId, cardMask));
        // У прострочці платник вписує картку рівно заради того, щоб борг
        // пройшов. Вимагати після цього окремого натискання означало б зайвий
        // крок у найгіршому для клієнта місці, тож списуємо одразу тим самим
        // шляхом, що й повторна спроба: та сама межа, той самий детермінований
        // ідентифікатор спроби, той самий захист від подвійного списання.
        // Суму платник бачив на екрані прив'язки до введення картки.
        if (before.status === SUBSCRIPTION_STATUS.PAST_DUE) {
            await this.settleDebtAfterCardChange(userId);
        }
    }

    /**
     * Списання боргу одразу після заміни картки у прострочці. Помилка тут не
     * має валити обробку вебхука: картку вже збережено, а невдале списання
     * лишає профіль у тій самій прострочці, де повторна спроба піде за
     * розкладом планувальника.
     */
    private async settleDebtAfterCardChange(userId: string): Promise<void> {
        try {
            await this.chargeDueCycleLocked(userId, {
                countsAsDunningAttempt: false,
            });
        } catch (error) {
            this.logger.error(
                `Debt charge after card change failed for user ${userId}`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    /**
     * Фіксує результат спроби прив'язки для сторінки повернення з банку — лише
     * тієї спроби, якою закінчився рахунок: сповіщення по старішому рахунку не
     * перетирає результат новішої спроби, з якої платник щойно повернувся.
     */
    private async markCardVerification(
        userId: string,
        orderReference: string,
        status: CardVerificationStatus,
        session: ClientSession
    ): Promise<void> {
        await this.profileModel.updateOne(
            {
                userId: new Types.ObjectId(userId),
                'cardVerification.orderReference': orderReference,
            },
            { $set: { 'cardVerification.status': status } },
            { session }
        );
    }

    /**
     * Лист про зміну картки. Зміна платіжного інструменту чутлива: якщо до
     * кабінету дістався хтось чужий, підміна картки саме те, що власник має
     * помітити. Best-effort, як решта білінг-листів.
     */
    private async notifyCardChanged(
        userId: string,
        cardMask: string | null
    ): Promise<void> {
        const user = await this.usersService.findById(userId);
        if (!user) return;
        await this.sendBillingEmailSafe(() =>
            this.emailService.sendCardChanged({
                email: user.email,
                cardMask,
            })
        );
    }

    /**
     * Success першої купівлі / resume: активація профілю, день-якір, токен,
     * повні кредити. Повертає businessId-и, відкріплені застосованим
     * відкладеним зменшенням (caller реконсилює їх разом з прикріпленими).
     */
    private async applyCheckoutActivation(
        event: BillingWebhookEvent,
        userId: string,
        session: ClientSession
    ): Promise<string[]> {
        if (this.isNonTerminal(event.status)) return [];
        const profile = await this.profileModel
            .findOne({ userId: new Types.ObjectId(userId) })
            .session(session)
            .lean();
        if (!profile) return [];

        if (event.status !== MONOBANK_INVOICE_STATUS.SUCCESS) {
            await this.recordPayment(
                {
                    userId,
                    orderReference: event.orderReference,
                    type: PAYMENT_RECORD_TYPE.CYCLE,
                    amount: event.amount,
                    currency: event.currency,
                    status: PAYMENT_RECORD_STATUS.DECLINED,
                    providerTransactionId: event.invoiceId,
                    card: event,
                },
                session
            );
            return [];
        }

        // Success по checkout-інвойсу, коли профіль УЖЕ активний, — оплата
        // застарілого інвойсу поверх активованого профілю (два створені
        // checkout-и, обидва оплачено; старий інвойс живе у monobank до
        // expiry). Повторна активація скинула б день-якір і межі щойно
        // оплаченого циклу, а гроші списались би вдвічі — тож не активуємо:
        // гроші пройшли, слід у ручний розбір (UNMATCHED + needsManualReview),
        // як і при розбіжності суми. Легітимні активації йдуть з INCOMPLETE
        // (перша купівля), PAST_DUE (resume) і CANCELED/UNPAID (новий checkout
        // згаслого профілю) — ACTIVE серед них не буває: startCheckout і resume
        // на ньому відхиляються ще до створення інвойсу.
        if (profile.status === SUBSCRIPTION_STATUS.ACTIVE) {
            this.logger.error(
                `Checkout ${event.orderReference} paid while profile is ` +
                    'already ACTIVE (stale invoice) — manual review'
            );
            await this.recordUnmatchedPayment(event, userId, session);
            return [];
        }

        // Checkout платить за ефективний склад НОВОГО циклу (resume після
        // прострочки застосовує відкладені зменшення разом з активацією).
        // Звірка суми обов'язкова: старий неоплачений checkout-інвойс живе у
        // monobank до expiry, а повторний checkout перезаписує бажані склади —
        // без звірки оплата дешевого інвойсу активувала б дорожчий склад.
        const effective = this.effectiveComposition(profile);
        // null — сітка змінилась між checkout-ом і оплатою і складу вже немає
        // у конфігу: активувати нічого, гроші у ручний розбір (UNMATCHED).
        let expectedAmount: number | null;
        try {
            expectedAmount = monthlyChargeAmount(this.grid, effective);
        } catch {
            expectedAmount = null;
        }
        if (expectedAmount === null || event.amount !== expectedAmount) {
            this.logger.error(
                `Checkout ${event.orderReference} amount mismatch: ` +
                    `paid ${event.amount}, expected ` +
                    `${expectedAmount ?? 'unpriceable composition (grid changed)'} — manual review`
            );
            await this.recordUnmatchedPayment(event, userId, session);
            return [];
        }

        // Прострочка: платник оплачує САМЕ той місяць, за який не пройшло
        // списання, тож підтвердження закриває стару межу так само, як успішна
        // автоматична спроба. Інакше день щомісячного списання переїхав би на
        // день оплати, а дні прострочки дісталися б безкоштовно — і то лише
        // тому, що платник натиснув кнопку сам, замість чекати повтору.
        // Прощення боргу план передбачає тільки після вимкнення доступу.
        //
        // Розводимо за станом профілю НА МОМЕНТ підтвердження, а не на момент
        // відкриття сторінки: рахунок банку живе довше за паузу повторних
        // спроб, тож платник цілком може оплатити його вже після вимкнення —
        // і це вже повернення після вимкнення, з новим місяцем від дня оплати.
        if (profile.status === SUBSCRIPTION_STATUS.PAST_DUE) {
            return this.applyPastDueSettlement(event, userId, profile, session);
        }

        const fresh = this.freshCycleFields(
            profile,
            event.occurredAt,
            event,
            event.cardToken,
            // Оплачено рівно бажаний склад (сума звірена вище), тож застосовуємо
            // відкладені зменшення до живих полів — знімок тут ні до чого.
            this.pendingDecreaseUpdates(profile)
        );
        // Durable-маркер + detached-список АТОМАРНО з флипом доступу (та сама
        // TX): caller реконсилює одразу після коміту, але крах/збій у вікні між
        // ними інакше лишив би прикріплені бізнеси з brandedAt=null (оплачено,
        // фічі не ввімкнулись) без жодного retry-тригера — вебхук уже ack-нутий
        // ('applied'), повторна доставка реконсиляцію не повторює.
        const updated = await this.applyProfileUpdate(
            userId,
            event,
            fresh.set,
            session,
            {
                pendingReconcileBusinessIds: fresh.detached.map(
                    (id) => new Types.ObjectId(id)
                ),
                pendingRevokeCardTokens: fresh.replacedToken
                    ? [fresh.replacedToken]
                    : [],
            }
        );
        if (!updated) return [];

        // Перша купівля = повний цикл → повний обсяг кредитів (top-up з 0).
        await this.topUpToCapInTx(
            userId,
            effective.documentsTierSize,
            `activation:${userId}:${fresh.periodEnd.getTime()}`,
            session
        );
        await this.recordPayment(
            {
                userId,
                orderReference: event.orderReference,
                type: PAYMENT_RECORD_TYPE.CYCLE,
                amount: event.amount,
                currency: event.currency,
                status: PAYMENT_RECORD_STATUS.APPROVED,
                providerTransactionId: event.invoiceId,
                card: event,
            },
            session
        );
        return fresh.detached;
    }

    /**
     * $set-фрагмент відкриття НОВОГО циклу від дня оплати: день щомісячного
     * списання стає днем оплати, відкладені зменшення застосовуються, лічильники
     * прострочки скидаються. Спільний для двох шляхів, що відкривають новий
     * місяць: оплата через сторінку банку і повернення збереженою карткою після
     * вимкнення доступу. Дні, коли доступу не було, при цьому прощаються: відлік
     * від старої межі поставив би новий місяць у минуле, і планувальник списав
     * би кілька місяців поспіль за час без сервісу.
     */
    private freshCycleFields(
        profile: BillingProfileLean,
        paidAt: Date,
        card: CardDetails,
        // Токен, з яким прийшла оплата: сторінка банку могла зберегти іншу
        // картку, і тоді попередню треба відкликати (див. `paidCardUpdates`).
        paidToken: string | null,
        // Чим стає склад після оплати. Оплата зі сторінки банку застосовує
        // відкладені зменшення до живих полів; повернення після вимкнення
        // доступу передає сюди відновлення складу зі знімка.
        composition: CompositionUpdates
    ): {
        set: Record<string, unknown>;
        detached: string[];
        periodEnd: Date;
        /** Витіснений токен — caller ставить його в чергу відкликання. */
        replacedToken: string | null;
    } {
        const anchorDay = paidAt.getDate();
        const periodEnd = nextCycleBoundary(paidAt, anchorDay);
        const set: Record<string, unknown> = {
            ...composition.set,
            status: SUBSCRIPTION_STATUS.ACTIVE,
            cancelAtPeriodEnd: false,
            currentPeriodStart: paidAt,
            anchorDay,
            currentPeriodEnd: periodEnd,
            nextChargeAt: periodEnd,
            dunningAttempts: 0,
            nextRetryAt: null,
            // Профіль ожив — точка відліку строку зберігання картки більше не
            // веде ні до чого: картка знову в роботі. Знімок складу теж: він
            // описував вимкнений стан, якого вже немає.
            ...this.clearDisabledStateFields(),
            needsManualReview: false,
            reconcileRequiredAt: new Date(),
        };
        const paidCard = this.paidCardUpdates(
            profile.cardToken,
            card,
            paidToken
        );
        Object.assign(set, paidCard.set);
        return {
            set,
            detached: composition.detached,
            periodEnd,
            replacedToken: paidCard.replacedToken,
        };
    }

    /**
     * $set-фрагмент повернення складу зі знімка вимкненого профілю. Пише ПОВНИЙ
     * склад обох всесвітів, а не лише дельту відкладеного зменшення: живі поля
     * профілю міг переписати покинутий checkout, і часткове відновлення лишило
     * б його ємність і прикріплення замість оплачених.
     */
    private restoreCompositionUpdates(
        composition: Composition
    ): CompositionUpdates {
        const { set, detached } = this.pendingDecreaseUpdates(composition);
        // Всесвіт, у якому було відкладене зменшення, свої поля вже отримав
        // (зменшена ємність + трим прикріплень) — повним складом їх не чіпаємо.
        if (set['brand.capacity'] === undefined) {
            set['brand.capacity'] = composition.brand.capacity;
            set['brand.attachedBusinessIds'] =
                composition.brand.attachedBusinessIds;
            set['brand.pendingCapacity'] = null;
            set['brand.pendingKeepBusinessIds'] = [];
        }
        if (set['documents.tierSize'] === undefined) {
            set['documents.tierSize'] = composition.documents.tierSize;
            set['documents.attachedBusinessIds'] =
                composition.documents.attachedBusinessIds;
            set['documents.pendingTierSize'] = null;
            set['documents.pendingKeepBusinessIds'] = [];
        }
        return { set, detached };
    }

    /**
     * Оплата простроченого місяця зі сторінки банку. Закриває ту саму межу, що
     * закрила б успішна автоматична спроба: день щомісячного списання і дата
     * наступного списання не зсуваються, відкладені зменшення застосовуються,
     * кредити доганяються тим самим ключем циклу (тож подвійного нарахування
     * не буде, навіть якщо потім дозвіриться цикловий запис спроби).
     */
    private async applyPastDueSettlement(
        event: BillingWebhookEvent,
        userId: string,
        profile: BillingProfileLean,
        session: ClientSession
    ): Promise<string[]> {
        const boundary = profile.currentPeriodEnd;
        if (!boundary) {
            this.logger.error(
                `Past-due checkout ${event.orderReference} on profile without ` +
                    'period boundary — manual review'
            );
            await this.recordUnmatchedPayment(event, userId, session);
            return [];
        }
        const detached = await this.advanceCycle(
            userId,
            boundary,
            event,
            event.cardToken,
            session
        );
        // Межу вже закрито: за той самий місяць прийшли другі гроші (наприклад,
        // повтор списання встиг пройти, поки платник був на сторінці банку).
        // Зсунути цикл ще раз не можна, мовчки загубити гроші теж — у розбір.
        if (detached === null) {
            this.logger.error(
                `Past-due checkout ${event.orderReference} paid for an already ` +
                    'closed cycle — manual review'
            );
            await this.recordUnmatchedPayment(event, userId, session);
            return [];
        }
        await this.recordPayment(
            {
                userId,
                orderReference: event.orderReference,
                type: PAYMENT_RECORD_TYPE.CYCLE,
                amount: event.amount,
                currency: event.currency,
                status: PAYMENT_RECORD_STATUS.APPROVED,
                providerTransactionId: event.invoiceId,
                card: event,
            },
            session
        );
        return detached;
    }

    /**
     * Гроші пройшли, але застосувати їх нема до чого: слід у історії плюс
     * ops-прапор. Спільна кінцівка для розбіжності суми, оплати застарілого
     * рахунку і другої оплати за вже закритий місяць.
     */
    private async recordUnmatchedPayment(
        event: BillingWebhookEvent,
        userId: string,
        session: ClientSession
    ): Promise<void> {
        await this.recordPayment(
            {
                userId,
                orderReference: event.orderReference,
                type: PAYMENT_RECORD_TYPE.UNMATCHED,
                amount: event.amount,
                currency: event.currency,
                status: PAYMENT_RECORD_STATUS.APPROVED,
                providerTransactionId: event.invoiceId,
                card: event,
            },
            session
        );
        await this.raiseManualReviewInTx(userId, session);
    }

    /**
     * Те саме для списання, чий запис спроби вже існує і щойно закритий як
     * успішний. Запис перекласифіковується, а не дублюється: в історії одне
     * списання, а не два. Фільтр за `invoiceId`, бо детермінований ідентифікатор
     * циклової спроби спільний з попередніми відхиленими спробами тієї ж межі.
     */
    private async markSettledChargeUnmatched(
        userId: string,
        orderReference: string,
        invoiceId: string,
        session: ClientSession
    ): Promise<void> {
        await this.paymentRecordModel.updateOne(
            {
                orderReference,
                providerTransactionId: invoiceId,
                status: PAYMENT_RECORD_STATUS.APPROVED,
            },
            { $set: { type: PAYMENT_RECORD_TYPE.UNMATCHED } },
            { session }
        );
        await this.raiseManualReviewInTx(userId, session);
    }

    /**
     * Ops-прапор без зупинки планувальника: гроші зайві, але підписка сама по
     * собі здорова, і наступне місячне списання має піти за розкладом. Лист
     * ops ставиться в чергу щоразу, навіть якщо прапорець уже стояв: кожен
     * такий платіж — окремі гроші до повернення.
     */
    private async raiseManualReviewInTx(
        userId: string,
        session: ClientSession
    ): Promise<void> {
        await this.profileModel.updateOne(
            { userId: new Types.ObjectId(userId) },
            {
                $set: {
                    needsManualReview: true,
                    manualReviewAlertDueAt: new Date(),
                },
            },
            { session }
        );
    }

    // ── Idempotency + webhook plumbing ───────────────────────────────────

    private async backfillCardToken(
        event: BillingWebhookEvent,
        userId: string
    ): Promise<void> {
        if (!event.cardToken) return;
        try {
            await this.profileModel.updateOne(
                {
                    userId: new Types.ObjectId(userId),
                    cardToken: null,
                },
                { $set: { cardToken: event.cardToken } }
            );
        } catch (error) {
            this.logger.error(
                `Failed to backfill card token for ${userId}`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

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

    private async applyProfileUpdate(
        userId: string,
        event: BillingWebhookEvent,
        set: Record<string, unknown>,
        session: ClientSession,
        // Durable-списки, що доповнюються тією самою атомарною операцією
        // (відкріплені бізнеси для реконсиляції, токени на відкликання):
        // $addToSet, не $set — невичищені значення від попереднього збою
        // мусять пережити запис.
        addToSet: Record<string, unknown[]> = {}
    ): Promise<boolean> {
        const update: Record<string, unknown> = {
            $set: { ...set, lastProviderEventAt: event.occurredAt },
        };
        const additions = Object.fromEntries(
            Object.entries(addToSet)
                .filter(([, values]) => values.length > 0)
                .map(([field, values]) => [field, { $each: values }])
        );
        if (Object.keys(additions).length > 0) {
            update['$addToSet'] = additions;
        }
        const updated = await this.profileModel.findOneAndUpdate(
            {
                userId: new Types.ObjectId(userId),
                $or: [
                    { lastProviderEventAt: null },
                    { lastProviderEventAt: { $lt: event.occurredAt } },
                ],
            },
            update,
            { new: true, session, maxTimeMS: WEBHOOK_MONGO_TIMEOUT_MS }
        );
        return updated != null;
    }

    private async insertWebhookEvent(
        event: BillingWebhookEvent,
        userId: string
    ): Promise<'new' | 'applied' | 'pending'> {
        try {
            await this.webhookEventModel.create({
                provider: PROVIDER,
                providerEventId: event.providerEventId,
                receivedAt: new Date(),
                occurredAt: event.occurredAt,
                type: event.status,
                userId,
                oneOffCode: null,
                status: 'pending',
            });
            return 'new';
        } catch (error) {
            if (isDuplicateKeyError(error)) {
                const existing = await this.webhookEventModel
                    .findOne({
                        provider: PROVIDER,
                        providerEventId: event.providerEventId,
                    })
                    .lean();
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
                `Failed to rollback webhook ${providerEventId}`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    // ── Claim-first primitives ───────────────────────────────────────────

    private async claimAttempt(
        userId: string,
        orderReference: string,
        type: PaymentRecordType,
        amount: number,
        currency: string,
        pendingEffect: PendingEffect | null,
        countsAsDunningAttempt = true
    ): Promise<'claimed' | 'exists'> {
        try {
            await this.paymentRecordModel.create({
                userId: new Types.ObjectId(userId),
                orderReference,
                type,
                amount,
                currency,
                status: PAYMENT_RECORD_STATUS.PENDING,
                providerTransactionId: null,
                cardMask: null,
                cardPaymentMethod: null,
                cardPaymentSystem: null,
                cardBank: null,
                refundAmount: null,
                pendingEffect,
                countsAsDunningAttempt,
            });
            return 'claimed';
        } catch (error) {
            if (isDuplicateKeyError(error)) return 'exists';
            throw error;
        }
    }

    private async releaseClaim(orderReference: string): Promise<void> {
        await this.paymentRecordModel.deleteOne({
            orderReference,
            status: PAYMENT_RECORD_STATUS.PENDING,
            providerTransactionId: null,
        });
    }

    private async settlePaymentRecord(
        orderReference: string,
        status:
            | typeof PAYMENT_RECORD_STATUS.APPROVED
            | typeof PAYMENT_RECORD_STATUS.DECLINED,
        invoiceId: string,
        card: CardDetails,
        session: ClientSession
    ): Promise<boolean> {
        const set: Record<string, unknown> = {
            status,
            providerTransactionId: invoiceId,
        };
        Object.assign(set, cardRecordFields(card));
        const res = await this.paymentRecordModel.updateOne(
            { orderReference, status: PAYMENT_RECORD_STATUS.PENDING },
            { $set: set },
            { session }
        );
        return res.modifiedCount === 1;
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
            card: CardDetails;
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
                    ...cardRecordFields(data.card),
                    refundAmount: null,
                    pendingEffect: null,
                },
            ],
            { session }
        );
    }

    /**
     * Прапор невідомого результату списання. Лист ops ставиться в чергу лише
     * при першому підйомі прапорця: звірка завислого запису повторює цей
     * виклик щогодини, і кожен повтор інакше слав би такий самий лист.
     */
    private async flagManualReview(userId: string): Promise<void> {
        await this.profileModel.updateOne(
            { userId: new Types.ObjectId(userId) },
            [
                {
                    $set: {
                        manualReviewAlertDueAt: {
                            $cond: [
                                '$needsManualReview',
                                '$manualReviewAlertDueAt',
                                new Date(),
                            ],
                        },
                        needsManualReview: true,
                        nextChargeAt: null,
                    },
                },
            ]
        );
    }

    /**
     * Лист на `OPS_ALERT_EMAIL` про кожен неповідомлений ручний розбір. Фоном, а
     * не в момент підйому прапорця: прапорець ставиться в транзакції, а лист
     * звідти пішов би двічі при її повторі. Збій відправки одного листа не
     * зриває решти.
     */
    async sendManualReviewAlerts(): Promise<void> {
        const due = await this.profileModel
            .find({ manualReviewAlertDueAt: { $type: 'date' } })
            .lean();
        for (const profile of due) {
            try {
                await this.sendManualReviewAlert(profile);
            } catch (error) {
                this.logger.error(
                    `Failed to send manual review alert for user ${profile.userId.toString()}`,
                    error instanceof Error ? error.stack : String(error)
                );
            }
        }
    }

    /**
     * Лист несе все, з чим іти в кабінет monobank: нерозпізнані списання
     * (гроші пройшли, але не зараховані) і незавершені (результат невідомий).
     * Мітку знімаємо лише після успішної відправки і лише якщо за час
     * відправки не з'явився новий розбір: тоді лист піде ще раз, уже з ним.
     */
    private async sendManualReviewAlert(
        profile: BillingProfileLean
    ): Promise<void> {
        const userId = profile.userId.toString();
        const [user, unmatched, unsettled] = await Promise.all([
            this.usersService.findById(userId),
            this.paymentRecordModel
                .find({
                    userId: profile.userId,
                    type: PAYMENT_RECORD_TYPE.UNMATCHED,
                })
                .sort({ createdAt: -1 })
                .limit(MANUAL_REVIEW_ALERT_UNMATCHED_LIMIT)
                .lean(),
            this.paymentRecordModel
                .find({
                    userId: profile.userId,
                    status: PAYMENT_RECORD_STATUS.PENDING,
                })
                .sort({ createdAt: -1 })
                .lean(),
        ]);
        const toCharge = (
            record: PaymentRecordLean
        ): ManualReviewAlertCharge => ({
            createdAt: record.createdAt,
            amount: record.amount,
            currency: record.currency,
            invoiceId: record.providerTransactionId,
            orderReference: record.orderReference,
        });
        await this.emailService.sendManualReviewAlert({
            userId,
            userEmail: user ? user.email : null,
            stillFlagged: profile.needsManualReview,
            unmatched: unmatched.map(toCharge),
            unsettled: unsettled.map(toCharge),
        });
        await this.profileModel.updateOne(
            {
                _id: profile._id,
                manualReviewAlertDueAt: profile.manualReviewAlertDueAt,
            },
            { $set: { manualReviewAlertDueAt: null } }
        );
    }

    /**
     * Термінальний settle claim-запису розв'язав невизначеність списання
     * (success/decline тепер відомі): знімаємо ops-прапор `needsManualReview`
     * і повертаємо вісь планувальника, яку зупинив `flagManualReview` —
     * без цього одна транспортна помилка назавжди зупиняла б місячні
     * продовження, хоча система вже сама довела списання до фіналу.
     * Ідемпотентно: на здоровому профілі перезаписує ті самі значення.
     * Вісь повертається лише профілю, який clock реально веде (ACTIVE без
     * cancelAtPeriodEnd): PAST_DUE живе на `nextRetryAt`, скасовані/згаслі —
     * ні на чому. Прострочена `currentPeriodEnd` у ролі `nextChargeAt` —
     * коректний catch-up: clock підбере профіль найближчим проходом.
     */
    private async clearChargeUncertainty(
        userId: string,
        session: ClientSession
    ): Promise<void> {
        await this.profileModel.updateOne(
            { userId: new Types.ObjectId(userId) },
            [
                {
                    $set: {
                        needsManualReview: false,
                        nextChargeAt: {
                            $cond: [
                                {
                                    $and: [
                                        {
                                            $eq: [
                                                '$status',
                                                SUBSCRIPTION_STATUS.ACTIVE,
                                            ],
                                        },
                                        { $eq: ['$cancelAtPeriodEnd', false] },
                                        { $ne: ['$currentPeriodEnd', null] },
                                    ],
                                },
                                '$currentPeriodEnd',
                                '$nextChargeAt',
                            ],
                        },
                    },
                },
            ],
            { session }
        );
    }

    // ── Reconcile triggers ───────────────────────────────────────────────

    /**
     * Best-effort реконсиляція; повертає true лише при ПОВНОМУ проході (включно
     * зі slug-rent у межах батч-ліміту). false — робота лишилась, durable-маркер
     * мусить пережити цей тригер, добʼє daily-sweep.
     */
    private async reconcileBusinessesSafe(
        businessIds: string[]
    ): Promise<boolean> {
        if (businessIds.length === 0) return true;
        try {
            return await this.reconciliation.reconcileBusinesses(businessIds);
        } catch (error) {
            this.logger.error(
                `Reconcile businesses failed`,
                error instanceof Error ? error.stack : String(error)
            );
            return false;
        }
    }

    /**
     * Множина businessId (рядками), що ще існують у БД (не видалені). Основа
     * лінивої чистки мертвих ref у складах і фільтра для публічного view.
     */
    private async existingBusinessIdSet(
        ids: Types.ObjectId[]
    ): Promise<Set<string>> {
        if (ids.length === 0) return new Set();
        const rows = await this.businessModel
            .find({ _id: { $in: ids }, deletedAt: null }, { _id: 1 })
            .lean();
        return new Set(rows.map((r) => r._id.toString()));
    }

    /**
     * Лінива чистка мертвих ref видалених бізнесів зі складів (план: «чистка
     * лінива при читанні складу чи списанні»). Викликається під per-user локом.
     * Мертвий ref на суму не впливає (ціна = ємність), але тримав би слот
     * зайнятим — тож прибираємо, щоб звільнити його для нового прикріплення.
     * Повертає свіжий профіль (перечитаний, якщо щось прибрано).
     */
    private async pruneDeadAttachments(
        userId: string,
        profile: BillingProfileLean
    ): Promise<BillingProfileLean> {
        const all = [
            ...profile.brand.attachedBusinessIds,
            ...profile.documents.attachedBusinessIds,
        ];
        const alive = await this.existingBusinessIdSet(all);
        const brandDead = profile.brand.attachedBusinessIds.filter(
            (id) => !alive.has(id.toString())
        );
        const docDead = profile.documents.attachedBusinessIds.filter(
            (id) => !alive.has(id.toString())
        );
        if (brandDead.length === 0 && docDead.length === 0) return profile;
        const pull: Record<string, unknown> = {};
        if (brandDead.length > 0) {
            pull['brand.attachedBusinessIds'] = { $in: brandDead };
        }
        if (docDead.length > 0) {
            pull['documents.attachedBusinessIds'] = { $in: docDead };
        }
        await this.profileModel.updateOne(
            { userId: new Types.ObjectId(userId) },
            { $pull: pull }
        );
        return (await this.getProfile(userId)) ?? profile;
    }

    /**
     * Реконсиляція всіх прикріплених бізнесів профілю (флип доступу: активація
     * checkout-у, вичерпаний dunning). Stamp-first: durable-маркер ставиться ДО
     * проходу і знімається лише після повного — транзієнтний збій тут інакше
     * лишив би бізнеси зі стейлим `brandedAt` без жодного retry-тригера.
     */
    private async reconcileAllAttached(
        userId: string,
        extraBusinessIds: string[] = []
    ): Promise<void> {
        const profile = await this.getProfile(userId);
        if (!profile) return;
        const marker = new Date();
        await this.profileModel.updateOne(
            { userId: new Types.ObjectId(userId) },
            { $set: { reconcileRequiredAt: marker } }
        );
        const complete = await this.reconcileBusinessesSafe(
            this.owedReconcileIds(profile, extraBusinessIds)
        );
        if (complete) await this.clearReconcileMarker(userId, marker);
    }

    /**
     * Повний реконсиляційний «борг» профілю: прикріплені бізнеси обох складів
     * плюс durable-список detached (`pendingReconcileBusinessIds`) від
     * попередніх незавершених проходів. Durable-маркер один на профіль, і
     * кожен новий тригер перезаписує його власним стемпом, — тому знімати
     * маркер (`clearReconcileMarker`) можна лише після повного проходу по
     * цьому набору. Вузький прохід (наприклад, лише щойно прикріплений бізнес)
     * стирав би слід чужої незавершеної реконсиляції: detached-бізнес, якого
     * у складах уже немає, назавжди лишався б з `brandedAt` (бренд-фічі
     * безкоштовно, slug-rent не виконався) без жодного retry-тригера.
     */
    private owedReconcileIds(
        profile: {
            brand: { attachedBusinessIds: Types.ObjectId[] };
            documents: { attachedBusinessIds: Types.ObjectId[] };
            pendingReconcileBusinessIds?: Types.ObjectId[];
        },
        extra: string[] = []
    ): string[] {
        const ids = [
            ...profile.brand.attachedBusinessIds,
            ...profile.documents.attachedBusinessIds,
            ...(profile.pendingReconcileBusinessIds ?? []),
        ].map((id) => id.toString());
        return [...new Set([...ids, ...extra])];
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

    // ── Guards / helpers ─────────────────────────────────────────────────

    private assertUniverseEnabled(universe: BillingUniverse): void {
        const enabled =
            universe === BILLING_UNIVERSE.BRAND
                ? BILLING_UNIVERSE_ENABLED.brand
                : BILLING_UNIVERSE_ENABLED.documents;
        if (!enabled) {
            throw new BadRequestException({
                code: RESPONSE_CODE.BILLING_UNIVERSE_DISABLED,
                message: 'Universe is disabled',
            });
        }
    }

    private async requireProfile(userId: string): Promise<BillingProfileLean> {
        const profile = await this.getProfile(userId);
        if (!profile) {
            throw new BadRequestException({
                code: RESPONSE_CODE.NO_BILLING_ACCOUNT,
                message: 'No billing profile',
            });
        }
        return profile;
    }

    /** Профіль з живим доступом і збереженим токеном (для token-списань). */
    private async requireChargeableProfile(
        userId: string
    ): Promise<BillingProfileLean> {
        const profile = await this.requireProfile(userId);
        // Скасований-до-кінця-періоду профіль: доступ і картка ще живі, але
        // платні дії свідомо заблоковані. Продати слот, що згасне на межі
        // періоду, означало б або повернення коштів, або тихе воскресіння
        // щойно скасованої підписки. Окремий код веде кабінет на відновлення —
        // після нього всі платні дії доступні як звичайно.
        if (this.isEntitled(profile) && profile.cancelAtPeriodEnd) {
            throw new BadRequestException({
                code: RESPONSE_CODE.BILLING_CANCEL_PENDING,
                message:
                    'Subscription canceled: paid changes resume after period end',
            });
        }
        if (!this.isEntitled(profile) || !profile.cardToken) {
            throw new BadRequestException({
                code: RESPONSE_CODE.BILLING_NO_CARD_ON_FILE,
                message: 'No saved card: complete first purchase',
            });
        }
        return profile;
    }

    /** Живий доступ: активний або у грейсі прострочки. */
    private isEntitled(profile: { status: string | null }): boolean {
        return (
            profile.status === SUBSCRIPTION_STATUS.ACTIVE ||
            profile.status === SUBSCRIPTION_STATUS.PAST_DUE
        );
    }

    /**
     * Доступ вимкнено вичерпаною прострочкою — стан, з якого повертає оплата
     * збереженою карткою. Не лише `status === UNPAID`: нова купівля, яку
     * платник почав і не довів до оплати, перезаписує статус на INCOMPLETE, а
     * мітка вимкнення лишається. Без неї стан був би незворотним — покинутий
     * checkout назавжди прибирав би єдиний шлях назад в один крок, і картка
     * лежала б до кінця строку зберігання без жодної дії під нею.
     *
     * Мітка тут необов'язкова лише для UNPAID: профілі, вимкнені до появи
     * мітки (Sprint 43), її не мають, а повертатись їм є куди.
     */
    private isAccessDisabledByNonPayment(profile: {
        status: string | null;
        dunningExhaustedAt: Date | null;
    }): boolean {
        if (profile.status === SUBSCRIPTION_STATUS.UNPAID) return true;
        return (
            profile.status === SUBSCRIPTION_STATUS.INCOMPLETE &&
            profile.dunningExhaustedAt != null
        );
    }

    /** Той самий стан у вигляді фільтра запису (див. `isAccessDisabledByNonPayment`). */
    private disabledByNonPaymentFilter(): FilterQuery<BillingProfileDocument> {
        return {
            $or: [
                { status: SUBSCRIPTION_STATUS.UNPAID },
                {
                    status: SUBSCRIPTION_STATUS.INCOMPLETE,
                    dunningExhaustedAt: { $type: 'date' },
                },
            ],
        };
    }

    /**
     * Скасований-до-кінця-періоду профіль, чий оплачений період уже минув:
     * clock його не веде (`nextChargeAt` null), формально він ще entitled, але
     * фактично лише чекає cron-згасання (`PaymentsCleanupService`).
     */
    private isCanceledPastPeriodEnd(profile: BillingProfileLean): boolean {
        return (
            profile.cancelAtPeriodEnd &&
            profile.currentPeriodEnd != null &&
            new Date(profile.currentPeriodEnd).getTime() < Date.now()
        );
    }

    /**
     * Блокує нову білінг-мутацію складу/кредитів, поки БУДЬ-ЯКЕ списання
     * платника висить нерозвʼязаним (PENDING-claim). Два різні хазарди:
     *  - негайне списання (claim з `pendingEffect`): цілі ефектів АБСОЛЮТНІ
     *    (нова ємність / пакет), обчислені від стану ДО застосування завислого
     *    ефекту — друга платна дія списала б гроші за ту саму ємність
     *    (подвійна оплата одного слота), а її ефект перетер би перший;
     *  - циклове списання (claim без `pendingEffect`): сума claim-у зафіксована
     *    за старим складом, а межа періоду вже минула (пропорція нульова) —
     *    збільшення у вікні до settle діставалось би безкоштовно на весь щойно
     *    оплачуваний цикл, заплановане зменшення advanceCycle застосував би до
     *    циклу, списаного за повною сумою, а відкликання запланованого
     *    зменшення лишило б стару ємність за вже зменшену суму claim-у.
     * Вікно коротке: завислий PENDING добиває вебхук або clock-reconcile
     * (щогодини). Викликається під per-user локом, тож check-then-act не
     * гонить із settle-шляхами (вони під тим самим локом).
     */
    private async assertNoUnsettledCharge(userId: string): Promise<void> {
        if (await this.hasUnsettledCharge(userId)) {
            throw new ConflictException({
                code: RESPONSE_CODE.BILLING_OPERATION_IN_PROGRESS,
                message: 'Previous charge is still settling, retry later',
            });
        }
    }

    /**
     * Чи висить за платником списання з нерозв'язаним результатом (claim-запис
     * у PENDING). Читають і гейт платних мутацій, і відновлення підписки, яке
     * через це не повертає вісь планувальника (див. `renewUpdates`).
     */
    private async hasUnsettledCharge(
        userId: string,
        session?: ClientSession
    ): Promise<boolean> {
        const query = this.paymentRecordModel.findOne({
            userId: new Types.ObjectId(userId),
            status: PAYMENT_RECORD_STATUS.PENDING,
        });
        if (session) query.session(session);
        return (await query.lean()) != null;
    }

    private async assertBusinessAccess(
        userId: string,
        businessId: string
    ): Promise<void> {
        const uid = new Types.ObjectId(userId);
        const business = await this.businessModel
            .findOne({
                _id: new Types.ObjectId(businessId),
                deletedAt: null,
                $or: [{ ownerId: uid }, { managers: uid }],
            })
            .lean();
        if (!business) {
            throw new ForbiddenException({
                code: RESPONSE_CODE.BUSINESS_ACCESS_DENIED,
                message: 'No access to business',
            });
        }
    }

    private universeCapacityValue(
        profile: BillingProfileLean,
        universe: BillingUniverse
    ): { value: number } {
        if (universe === BILLING_UNIVERSE.BRAND) {
            return { value: profile.brand.capacity };
        }
        return { value: profile.documents.tierSize ?? 0 };
    }

    private targetCapacityValue(dto: ChangeCapacity): number {
        if (dto.universe === BILLING_UNIVERSE.BRAND) {
            if (dto.capacity == null) {
                throw new BadRequestException({
                    code: RESPONSE_CODE.INVALID_CAPACITY,
                    message: 'capacity required',
                });
            }
            return dto.capacity;
        }
        const t = dto.tierSize ?? null;
        if (t === null) return 0; // прибрати документний всесвіт
        if (!findDocumentsTierBySize(this.grid.documents, t)) {
            throw new BadRequestException({
                code: RESPONSE_CODE.INVALID_TIER,
                message: 'Unknown documents tier',
            });
        }
        return t;
    }

    private universeMonthly(universe: BillingUniverse, value: number): number {
        if (universe === BILLING_UNIVERSE.BRAND) {
            return brandMonthlyAmount(this.grid.brand, value);
        }
        return documentsMonthlyAmount(
            this.grid.documents,
            value === 0 ? null : value
        );
    }

    private universeLabel(universe: BillingUniverse): string {
        return universe === BILLING_UNIVERSE.BRAND ? 'Бренд' : 'Документи';
    }

    private cycleWindow(
        profile: BillingProfileLean,
        now: Date
    ): { daysRemaining: number; daysInCycle: number } {
        const start = profile.currentPeriodStart
            ? new Date(profile.currentPeriodStart).getTime()
            : now.getTime();
        const end = profile.currentPeriodEnd
            ? new Date(profile.currentPeriodEnd).getTime()
            : now.getTime();
        const daysInCycle = Math.max(1, Math.round((end - start) / DAY_MS));
        const daysRemaining = Math.max(
            0,
            Math.ceil((end - now.getTime()) / DAY_MS)
        );
        return { daysRemaining, daysInCycle };
    }

    private isNonTerminal(status: string): boolean {
        return (MONOBANK_NON_TERMINAL_STATUSES as readonly string[]).includes(
            status
        );
    }

    private serviceUrl(): string {
        return `${ENV.WEB_URL}/api/payments/webhook/${PROVIDER}`;
    }

    private returnUrl(returnPath?: string, flow?: BillingReturnFlow): string {
        const params = new URLSearchParams();
        if (returnPath) params.set('returnPath', returnPath);
        if (flow) params.set('flow', flow);
        const query = params.toString();
        return `${ENV.WEB_URL}/billing-return${query ? `?${query}` : ''}`;
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

/**
 * Необоротний відбиток токена картки для логів. Сам токен це платіжний секрет:
 * у профілі він ніколи не серіалізується, у лист ops його свідомо не кладуть —
 * тож і в лог він потрапляти не сміє. Але відкликання мусить лишати слід, за
 * яким видно, про яку саме картку йдеться, коли в черзі платника їх кілька.
 * Восьми шістнадцяткових знаків досить, щоб розрізнити токени одного платника,
 * і замало, щоб з відбитка щось відновити.
 */
function cardTokenFingerprint(cardToken: string): string {
    return createHash('sha256').update(cardToken).digest('hex').slice(0, 8);
}

/**
 * Відмова банку, яка стосується САМЕ картки: 400 — за цією карткою рахунок не
 * прийнято, 404 — такого токена банк не знає (відкликаний, ротований). Повтор
 * тією самою карткою дасть те саме, тож платнику треба показати відмову і шлях
 * до заміни картки. Та сама межа, що й у відкликанні токена
 * (`deleteCardTokenAtProvider`): 400/404 остаточні, решта — тимчасове.
 *
 * Інші 4xx (ліміт запитів, наша авторизація у банку) картки не стосуються і
 * минають самі — там чесніше сказати «спробуйте за хвилину».
 */
function isCardRefusal(error: ProviderRequestError): boolean {
    return error.status === 400 || error.status === 404;
}

function isBillingLockBusy(error: unknown): boolean {
    return (
        error instanceof ConflictException &&
        (error.getResponse() as { code?: string })?.code ===
            RESPONSE_CODE.BILLING_OPERATION_IN_PROGRESS
    );
}

/**
 * Наступна межа циклу: наступний місяць від `from`, день = `anchorDay` з clamp
 * до останнього дня місяця. Рахувати від якоря (а не від дня попередньої межі)
 * критично: 31 січ → 28 лют → 31 бер, без незворотного дрейфу на менший день.
 */
function nextCycleBoundary(from: Date, anchorDay: number): Date {
    const next = new Date(from);
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    const lastDay = new Date(
        next.getFullYear(),
        next.getMonth() + 1,
        0
    ).getDate();
    next.setDate(Math.min(anchorDay, lastDay));
    return next;
}
