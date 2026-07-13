import { randomBytes } from 'crypto';
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
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
    BILLING_CURRENCY,
    BILLING_UNIVERSE,
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
    type StartCheckout,
} from '@finly/types';
import { ENV } from '../../config/env';
import {
    ChargeResult,
    IPaymentProvider,
    PAYMENT_PROVIDER,
    ProviderRequestError,
} from './interfaces/payment-provider.interface';
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
import { EmailService } from '../email/email.service';
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
    buildCheckoutOrderReference,
    buildCreditPackOrderReference,
    buildCycleOrderReference,
    buildProrationOrderReference,
    cycleBoundaryFromRef,
    parseOrderReference,
    type ParsedOrderReference,
} from './order-reference';

const PROVIDER = 'monobank';
const WEBHOOK_MONGO_TIMEOUT_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Див. RESUME_DUNNING_HOLD пояснення у старому сервісі — те саме вікно. */
const RESUME_DUNNING_HOLD_MS = 30 * 60 * 1000;

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
    private readonly grid: BillingGrid = ENV.BILLING_GRID;

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
     * `BILLING_DOC_TIERS` пакет, на якому сидять оплачені профілі
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
                `❌ BILLING_DOC_TIERS has no size(s) [${missing.join(', ')}] ` +
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
            // Наступне списання — за ЕФЕКТИВНИМ складом (відкладені зменшення
            // враховано): саме цю суму clock спише на межі циклу. Без живого
            // доступу списання не буде (0); заразом stale-склад INCOMPLETE/
            // CANCELED профілю (пакет міг зникнути з сітки) не рве view.
            nextChargeAmount: this.isEntitled(p)
                ? this.effectiveMonthlyAmount(p)
                : 0,
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

    // ── Cancel / resume ──────────────────────────────────────────────────

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
                        cardToken: null,
                    },
                }
            );
        });
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
        const currency = profile.currency ?? BILLING_CURRENCY;

        await this.claimAttempt(
            userId,
            orderReference,
            type,
            amount,
            currency,
            effect
        );

        let result: ChargeResult;
        try {
            result = await this.provider.chargeByToken({
                orderReference,
                cardToken: profile.cardToken!,
                amount,
                currency,
                productName,
                serviceUrl: this.serviceUrl(),
            });
        } catch (error) {
            if (
                error instanceof ProviderRequestError &&
                error.chargeDefinitelyNotApplied
            ) {
                await this.releaseClaim(orderReference);
                throw new ConflictException({
                    code: RESPONSE_CODE.BILLING_OPERATION_IN_PROGRESS,
                    message: 'Charge rejected, retry',
                });
            }
            this.logger.error(
                `Immediate charge transport failure for ${orderReference}`,
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
            // Рідкісний async: ефект застосує clock-reconcile за pendingEffect.
            return true;
        }
        if (result.status === MONOBANK_INVOICE_STATUS.SUCCESS) {
            await this.settleImmediateSuccess(
                userId,
                orderReference,
                result.invoiceId,
                result.cardMask
            );
            return false;
        }
        // Термінальна відмова: гроші не взято, ефект не застосовуємо.
        await this.settleImmediateDecline(
            userId,
            orderReference,
            result.invoiceId,
            result.cardMask
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
        cardMask: string | null
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
            cardMask,
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
        cardMask: string | null
    ): Promise<void> {
        const session = await this.connection.startSession();
        try {
            await session.withTransaction(async () => {
                const matched = await this.settlePaymentRecord(
                    orderReference,
                    PAYMENT_RECORD_STATUS.DECLINED,
                    invoiceId,
                    cardMask,
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
        cardMask: string | null,
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
                    cardMask,
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

    private async chargeDueCycleLocked(userId: string): Promise<void> {
        const profile = await this.getProfile(userId);
        if (
            !profile ||
            profile.cancelAtPeriodEnd ||
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
            null
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
            cardMask: result.cardMask,
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
            if (record.type === PAYMENT_RECORD_TYPE.CYCLE) {
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
                event.cardMask
            );
        } else {
            await this.settleImmediateDecline(
                userId,
                orderReference,
                event.invoiceId,
                event.cardMask
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
            cardMask: event.cardMask,
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
            cardMask: string | null;
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
                ctx.cardMask,
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
            ctx.invoiceId,
            ctx.cardMask
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
                    maxAttempts: ENV.BILLING_DUNNING_MAX_ATTEMPTS,
                })
            );
        }
    }

    /**
     * Атомарно: settle PENDING→APPROVED + просування періоду + застосування
     * відкладених зменшень + top-up-to-cap. Повертає detached businessIds (для
     * реконсиляції) або null, якщо перехід уже зроблено.
     */
    private async commitCycleSuccess(
        userId: string,
        orderReference: string,
        boundary: Date,
        invoiceId: string,
        cardMask: string | null,
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
                    cardMask,
                    session
                );
                if (!matched) return;
                const detached = await this.advanceCycle(
                    userId,
                    boundary,
                    cardMask,
                    cardToken,
                    session
                );
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
     */
    private async advanceCycle(
        userId: string,
        boundary: Date,
        cardMask: string | null,
        cardToken: string | null,
        session: ClientSession
    ): Promise<string[]> {
        const profile = await this.profileModel
            .findOne({
                userId: new Types.ObjectId(userId),
                currentPeriodEnd: boundary,
            })
            .session(session)
            .lean();
        if (!profile) return []; // уже просунуто

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
        set['needsManualReview'] = false;
        set['lastProviderEventAt'] = new Date();
        if (cardMask) set['cardMask'] = cardMask;
        if (cardToken) set['cardToken'] = cardToken;

        const update: Record<string, unknown> = { $set: set };
        if (detached.length > 0) {
            // Маркер + detached-список атомарно з тримом прикріплень: caller
            // реконсилює detached після коміту, але без durable-сліду крах у
            // цьому вікні лишив би відкріплений бізнес із brandedAt (бренд
            // безкоштовно) назавжди — у складах його вже немає, sweep по
            // прикріплених його не бачить.
            set['reconcileRequiredAt'] = new Date();
            update['$addToSet'] = {
                pendingReconcileBusinessIds: {
                    $each: detached.map((id) => new Types.ObjectId(id)),
                },
            };
        }
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
    private pendingDecreaseUpdates(profile: BillingProfileLean): {
        set: Record<string, unknown>;
        detached: string[];
    } {
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
                cardToken: null,
                reconcileRequiredAt: marker,
            },
        };
        if (detached.length > 0) {
            // Тримнуті відкладеним зменшенням зникають зі складів цим же
            // update-ом — durable-список тримає їх видимими для sweep, якщо
            // реконсиляція нижче не добіжить.
            update['$addToSet'] = {
                pendingReconcileBusinessIds: {
                    $each: detached.map((id) => new Types.ObjectId(id)),
                },
            };
        }
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

    private async commitCycleDecline(
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
                if (!matched) return;
                const profile = await this.profileModel
                    .findOne({ userId: new Types.ObjectId(userId) })
                    .session(session)
                    .lean();
                const attempts = (profile?.dunningAttempts ?? 0) + 1;
                const exhausted = attempts >= ENV.BILLING_DUNNING_MAX_ATTEMPTS;
                // Decline — визначений результат: якщо цю спробу супроводжував
                // transport-unknown прапор, він знімається (дунінг сам веде
                // профіль далі через nextRetryAt / термінальний UNPAID).
                if (exhausted) {
                    await this.profileModel.updateOne(
                        { userId: new Types.ObjectId(userId) },
                        {
                            $set: {
                                status: SUBSCRIPTION_STATUS.UNPAID,
                                dunningAttempts: attempts,
                                nextChargeAt: null,
                                nextRetryAt: null,
                                cardToken: null,
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
                    const nextRetryAt = new Date(
                        Date.now() +
                            ENV.BILLING_DUNNING_RETRY_INTERVAL_HOURS * 3_600_000
                    );
                    await this.profileModel.updateOne(
                        { userId: new Types.ObjectId(userId) },
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
        try {
            return await this.withBillingLock(parsed.userId, () =>
                this.routeTransaction(event, parsed)
            );
        } catch (error) {
            if (isBillingLockBusy(error)) return false;
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
        const insert = await this.insertWebhookEvent(event, parsed.userId);
        if (insert === 'applied') {
            await this.backfillCardToken(event, parsed.userId);
            return true;
        }
        if (insert === 'pending') return false;

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
                    cardMask: event.cardMask,
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
            await this.profileModel.updateOne(
                { userId: new Types.ObjectId(userId) },
                { $set: { needsManualReview: true } },
                { session }
            );
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
            await this.profileModel.updateOne(
                { userId: new Types.ObjectId(userId) },
                { $set: { needsManualReview: true } },
                { session }
            );
            return [];
        }

        const periodStart = event.occurredAt;
        // День-якір = день першої проплати; межі всіх наступних циклів
        // рахуються від нього (nextCycleBoundary), не від попередньої межі.
        const anchorDay = periodStart.getDate();
        const periodEnd = nextCycleBoundary(periodStart, anchorDay);
        const decrease = this.pendingDecreaseUpdates(profile);
        // Durable-маркер + detached-список АТОМАРНО з флипом доступу (та сама
        // TX): caller реконсилює одразу після коміту, але крах/збій у вікні між
        // ними інакше лишив би прикріплені бізнеси з brandedAt=null (оплачено,
        // фічі не ввімкнулись) без жодного retry-тригера — вебхук уже ack-нутий
        // ('applied'), повторна доставка реконсиляцію не повторює.
        const set: Record<string, unknown> = {
            ...decrease.set,
            status: SUBSCRIPTION_STATUS.ACTIVE,
            cancelAtPeriodEnd: false,
            currentPeriodStart: periodStart,
            anchorDay,
            currentPeriodEnd: periodEnd,
            nextChargeAt: periodEnd,
            dunningAttempts: 0,
            nextRetryAt: null,
            needsManualReview: false,
            reconcileRequiredAt: new Date(),
        };
        if (event.cardToken) set['cardToken'] = event.cardToken;
        if (event.cardMask) set['cardMask'] = event.cardMask;
        const updated = await this.applyProfileUpdate(
            userId,
            event,
            set,
            session,
            decrease.detached.map((id) => new Types.ObjectId(id))
        );
        if (!updated) return [];

        // Перша купівля = повний цикл → повний обсяг кредитів (top-up з 0).
        await this.topUpToCapInTx(
            userId,
            effective.documentsTierSize,
            `activation:${userId}:${periodEnd.getTime()}`,
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
                cardMask: event.cardMask,
            },
            session
        );
        return decrease.detached;
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
        // Відкріплені бізнеси у durable-список реконсиляції (та сама атомарна
        // операція, що й флип): $addToSet, не $set — старі невичищені ID від
        // попереднього збою мусять пережити запис.
        addPendingReconcile: Types.ObjectId[] = []
    ): Promise<boolean> {
        const update: Record<string, unknown> = {
            $set: { ...set, lastProviderEventAt: event.occurredAt },
        };
        if (addPendingReconcile.length > 0) {
            update['$addToSet'] = {
                pendingReconcileBusinessIds: { $each: addPendingReconcile },
            };
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
        pendingEffect: PendingEffect | null
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
                refundAmount: null,
                pendingEffect,
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
                    pendingEffect: null,
                },
            ],
            { session }
        );
    }

    private async flagManualReview(userId: string): Promise<void> {
        await this.profileModel.updateOne(
            { userId: new Types.ObjectId(userId) },
            { $set: { needsManualReview: true, nextChargeAt: null } }
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
                ? ENV.BILLING_BRAND_ENABLED
                : ENV.BILLING_DOCUMENTS_ENABLED;
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
        // Скасований-до-кінця-періоду профіль (cancel стер токен, доступ ще
        // живий) — окремий код: «немає картки, оформіть першу оплату» тут
        // збрехав би, бо startCheckout на entitled-профілі відхиляється
        // BILLING_ALREADY_ACTIVE до згасання профілю на межі періоду.
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
        const unsettled = await this.paymentRecordModel
            .findOne({
                userId: new Types.ObjectId(userId),
                status: PAYMENT_RECORD_STATUS.PENDING,
            })
            .lean();
        if (unsettled) {
            throw new ConflictException({
                code: RESPONSE_CODE.BILLING_OPERATION_IN_PROGRESS,
                message: 'Previous charge is still settling, retry later',
            });
        }
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

    private returnUrl(returnPath?: string): string {
        const query = returnPath
            ? `?returnPath=${encodeURIComponent(returnPath)}`
            : '';
        return `${ENV.WEB_URL}/billing-return${query}`;
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
