import {
    BadRequestException,
    ConflictException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    Logger,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
    ClientSession,
    Connection,
    Model,
    Types,
    type FilterQuery,
} from 'mongoose';
import {
    RESPONSE_CODE,
    VAT_ALLOWED_TAXATION_SYSTEMS,
    isTaxIdValidForType,
    isTaxationAllowedForType,
    requiresTaxation,
    type BusinessWithCounts,
    type CreateBusinessRequest,
    type UpdateBusinessRequest,
} from '@finly/types';

import { isTransactionsUnsupportedError } from '../../common/mongoose/transactions-unsupported';
import {
    AccountSlugHistory,
    type AccountSlugHistoryDocument,
} from '../accounts/schemas/account-slug-history.schema';
import {
    Account,
    type AccountDocument,
} from '../accounts/schemas/account.schema';
import {
    InvoiceSlugCounter,
    type InvoiceSlugCounterDocument,
} from '../invoices/schemas/invoice-slug-counter.schema';
import {
    InvoiceSlugHistory,
    type InvoiceSlugHistoryDocument,
} from '../invoices/schemas/invoice-slug-history.schema';
import {
    Invoice,
    type InvoiceDocument,
} from '../invoices/schemas/invoice.schema';
import {
    BusinessSlugHistory,
    BusinessSlugHistoryDocument,
} from './schemas/business-slug-history.schema';
import { Business, BusinessDocument } from './schemas/business.schema';
import { SlugGeneratorService } from './slug-generator.service';

/**
 * Sprint 3 §3.2 — primary CRUD service для бізнесів cabinet-зони.
 *
 * **Slug-нормалізація.** `slug` — case-preserved (display); `slugLower` —
 * нормалізована форма для unique-index і lookup-у. Сервіс — єдина точка, де
 * робиться `slug.toLowerCase()`; Mongoose pre-save hook **навмисно не
 * використовуємо** (sprint plan §3.1: "переваги другому варіанту, бо явніше
 * і тестується ізольовано").
 *
 * **Ownership правило (рішення E5).**
 *   - `worksAsBookkeeper === true` → `ownerId = null`, `managers = [userId]`
 *     (бізнес ведений бухгалтером для клієнта, що ще не у Finly).
 *   - `worksAsBookkeeper === false` → `ownerId = userId`, `managers = []`.
 *   Toggle живе на user-документі; service читає поточний стан з аргументу
 *   `isBookkeeperMode` (controller дістає з `user.worksAsBookkeeper` і пасує
 *   далі — щоб service не depend-ив на `UsersService` циркулярно).
 *
 * **`getOwnedAndManaged` — фільтр для toggle-перемикання** (E5):
 *   - bookkeeper ON → ownerless-бізнеси, де userId ∈ managers.
 *   - bookkeeper OFF → owned-бізнеси, де ownerId === userId.
 *   Toggle-перемикання тільки **ховає/показує** бізнеси, не архівує.
 *
 * **`update` — coupled VAT × taxationSystem cross-field check.**
 *   Sprint 3 §3.1 §3.2: write-DTO Zod skip-ить refine, якщо передано тільки
 *   одне з полів пари. Service атомарно перевіряє пару у `findOneAndUpdate`
 *   через `$expr`-filter — incoming-літерал замінює `'$<fieldname>'`-reference
 *   на існуюче поле документа, тож happy path — single round-trip. Якщо
 *   filter блокує update (повертає null), fallback `exists()`-запит
 *   розрізняє 404 (документу немає) vs 400 (`INVALID_VAT_FOR_TAXATION_SYSTEM`).
 */
@Injectable()
export class BusinessesService {
    private readonly logger = new Logger(BusinessesService.name);

    constructor(
        @InjectModel(Business.name)
        private readonly businessModel: Model<BusinessDocument>,
        @InjectModel(BusinessSlugHistory.name)
        private readonly historyModel: Model<BusinessSlugHistoryDocument>,
        @InjectModel(Account.name)
        private readonly accountModel: Model<AccountDocument>,
        @InjectModel(AccountSlugHistory.name)
        private readonly accountHistoryModel: Model<AccountSlugHistoryDocument>,
        @InjectModel(Invoice.name)
        private readonly invoiceModel: Model<InvoiceDocument>,
        @InjectModel(InvoiceSlugHistory.name)
        private readonly invoiceHistoryModel: Model<InvoiceSlugHistoryDocument>,
        @InjectModel(InvoiceSlugCounter.name)
        private readonly counterModel: Model<InvoiceSlugCounterDocument>,
        @InjectConnection()
        private readonly connection: Connection,
        private readonly slugGenerator: SlugGeneratorService
    ) {}

    async create(
        userId: string,
        dto: CreateBusinessRequest,
        isBookkeeperMode: boolean
    ): Promise<BusinessDocument> {
        const userObjectId = new Types.ObjectId(userId);

        const ownership = isBookkeeperMode
            ? { ownerId: null, managers: [userObjectId] }
            : { ownerId: userObjectId, managers: [] as Types.ObjectId[] };

        // Sprint 10 §SP-11 — anon-claim replay через partial-unique-index
        // `(ownerId, claimIdempotencyKey)`. Pre-check уникає вторинного insert
        // у happy-path; partial-unique-index ловить race-window між findOne
        // та create. **Ownership-aware filter** покриває обидва режими:
        // owned (`ownerId=userId`) і bookkeeper (`ownerId=null` +
        // `managers ∋ userId`); plain `{ownerId: userId}`-filter не
        // спрацював би для bookkeeper-документа, де ownerId зберігається як
        // null.
        const replayFilter = dto.claimIdempotencyKey
            ? this.buildClaimReplayFilter(
                  userObjectId,
                  isBookkeeperMode,
                  dto.claimIdempotencyKey
              )
            : null;
        if (replayFilter) {
            const existing = await this.businessModel
                .findOne(replayFilter)
                .exec();
            if (existing) {
                return existing;
            }
        }

        const slug = await this.slugGenerator.generateRandomSlug();

        // Sprint 7 §SP-3 — discriminated-union variants `individual` /
        // `organization` фізично не містять taxation-полів у DTO-shape. Mongoose
        // schema має `default: null`, але для type-safety і явності контракту
        // (Mongoose default спрацьовує на рівні документа, не на spread-у dto)
        // нормалізуємо тут: для не-taxation типів — non-undefined `null`, що
        // robustно проходить через будь-який middleware/transform.
        //
        // Discriminator-narrowing через literal-comparison: TS звужує
        // `CreateBusinessRequest` до fop/tov-variant-у і дає доступ до
        // `taxationSystem` / `isVatPayer` без cast-ів.
        const taxationFields =
            dto.type === 'fop' || dto.type === 'tov'
                ? {
                      taxationSystem: dto.taxationSystem,
                      isVatPayer: dto.isVatPayer,
                  }
                : { taxationSystem: null, isVatPayer: null };

        try {
            return await this.businessModel.create({
                ...dto,
                ...taxationFields,
                slug,
                slugLower: slug.toLowerCase(),
                ...ownership,
            });
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                const keyPattern = readKeyPattern(err);
                // Sprint 10 §SP-11 — race-window між pre-check findOne і
                // insert: concurrent claim з тим самим (userId, key) дойшов
                // до insert-а раніше. Partial-unique-index блокує другий
                // insert; ловимо 11000 на саме цьому компоунд-ключі і
                // повертаємо existing-документ як replay-shape (та сама
                // contract-семантика, що у pre-check-гілці вище).
                if (replayFilter && keyPattern.claimIdempotencyKey === 1) {
                    const existing = await this.businessModel
                        .findOne(replayFilter)
                        .exec();
                    if (existing) {
                        return existing;
                    }
                }
                // Sprint 3 — race condition: SlugGenerator щойно перевірив
                // `slugLower` як вільний, але паралельний create зайняв його
                // раніше за наш insert. Для 8-char × 62-alphabet алфавіту
                // вірогідність ≈ 0, але defensively ловимо і кидаємо
                // SLUG_GENERATION_FAILED — сигнал для алерту, не user-facing
                // помилка.
                this.logger.error(
                    `Slug collision race for "${slug}" (slugLower=${slug.toLowerCase()})`
                );
                throw new InternalServerErrorException({
                    code: RESPONSE_CODE.SLUG_GENERATION_FAILED,
                    message: 'Slug collision; please retry',
                });
            }
            throw err;
        }
    }

    private buildClaimReplayFilter(
        userObjectId: Types.ObjectId,
        isBookkeeperMode: boolean,
        claimIdempotencyKey: string
    ): FilterQuery<BusinessDocument> {
        return isBookkeeperMode
            ? {
                  ownerId: null,
                  managers: userObjectId,
                  claimIdempotencyKey,
              }
            : { ownerId: userObjectId, claimIdempotencyKey };
    }

    async getOwnedAndManaged(
        userId: string,
        isBookkeeperMode: boolean
    ): Promise<BusinessDocument[]> {
        const userObjectId = new Types.ObjectId(userId);
        const filter = isBookkeeperMode
            ? { ownerId: null, managers: userObjectId }
            : { ownerId: userObjectId };
        return this.businessModel.find(filter).sort({ createdAt: -1 }).exec();
    }

    /**
     * Sprint 9 §9.1 — list з **двома counters** `accountsCount` +
     * `invoicesCount` per item у одному round-trip. Раніше Sprint 4
     * `getOwnedAndManagedWithInvoicesCount` повертав тільки `invoicesCount`.
     *
     * **Два `$lookup`-stage:**
     *  - `accounts` collection через `businessId` → `$count` → `accountsCount`.
     *  - `invoices` collection напряму через `businessId` (denormalized field,
     *    Sprint 9 §SP-6 збережений) → `$count` → `invoicesCount`. Прямий
     *    lookup без trip через accounts.
     *
     * **Повертає plain-objects** (aggregate output не проходить через
     * Mongoose `toJSON`-transform); `_id → id`-mapping робиться у pipeline.
     */
    async getOwnedAndManagedWithCounts(
        userId: string,
        isBookkeeperMode: boolean
    ): Promise<BusinessWithCounts[]> {
        const userObjectId = new Types.ObjectId(userId);
        const matchFilter = isBookkeeperMode
            ? { ownerId: null, managers: userObjectId }
            : { ownerId: userObjectId };
        const result = await this.businessModel
            .aggregate([
                { $match: matchFilter },
                {
                    $lookup: {
                        from: 'accounts',
                        let: { bid: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: { $eq: ['$businessId', '$$bid'] },
                                },
                            },
                            { $count: 'count' },
                        ],
                        as: '__accountsCount',
                    },
                },
                {
                    $lookup: {
                        from: 'invoices',
                        let: { bid: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: { $eq: ['$businessId', '$$bid'] },
                                },
                            },
                            { $count: 'count' },
                        ],
                        as: '__invoicesCount',
                    },
                },
                {
                    $addFields: {
                        accountsCount: {
                            $ifNull: [
                                {
                                    $arrayElemAt: ['$__accountsCount.count', 0],
                                },
                                0,
                            ],
                        },
                        invoicesCount: {
                            $ifNull: [
                                {
                                    $arrayElemAt: ['$__invoicesCount.count', 0],
                                },
                                0,
                            ],
                        },
                        id: { $toString: '$_id' },
                    },
                },
                {
                    $unset: [
                        '__accountsCount',
                        '__invoicesCount',
                        '_id',
                        '__v',
                    ],
                },
                { $sort: { createdAt: -1 } },
            ])
            .exec();
        return result as BusinessWithCounts[];
    }

    /**
     * Case-insensitive lookup. Спільний primitive для cabinet (через guard) і
     * public controller. Повертає `null` якщо не знайдено — caller вирішує,
     * як перетворити на 404 (різні response-shape для cabinet vs public).
     *
     * **Cabinet-only.** Public-зона ходить через `getBySlugOrHistorical` —
     * fallback у `BusinessSlugHistory` для 308-redirect збережених посилань.
     * Cabinet навмисно strict: stale-URL у власному кабінеті → 404, бо frontend
     * усі переходи робить з current-state (`business.slug`); stale-URL = stale
     * browser-tab, не valid flow.
     */
    async getBySlug(slug: string): Promise<BusinessDocument | null> {
        return this.businessModel
            .findOne({ slugLower: slug.toLowerCase() })
            .exec();
    }

    /**
     * Sprint 14 — public lookup з history-fallback. Якщо `slug` не знайдений
     * у `Business.slugLower`, але є у `BusinessSlugHistory.slugLower` (rename
     * у межах TTL 90 днів), повертає **поточний** Business документ. Caller
     * (public controller) повертає view з `business.slug` як canonical; SC
     * `host-pay/[slug]/page.tsx` ловить `params.slug !== view.slug` і робить
     * `permanentRedirect()` на canonical URL.
     *
     * Один extra query лише на cache-miss old-slug — happy-path (поточний slug)
     * не платить нічого (`historyExists` не викликається коли business знайдено).
     */
    async getBySlugOrHistorical(
        slug: string
    ): Promise<BusinessDocument | null> {
        const slugLower = slug.toLowerCase();
        const business = await this.businessModel.findOne({ slugLower }).exec();
        if (business) return business;
        const historyEntry = await this.historyModel
            .findOne({ slugLower })
            .lean<{ businessId: Types.ObjectId }>()
            .exec();
        if (!historyEntry) return null;
        return this.businessModel.findById(historyEntry.businessId).exec();
    }

    async update(
        slug: string,
        dto: UpdateBusinessRequest
    ): Promise<BusinessDocument> {
        const slugLower = slug.toLowerCase();

        // Sprint 14 — vanity-slug edit. Detection by lowercase різниця
        // (case-only change — `business.slug` оновлюється, але `slugLower`
        // лишається той самий → history insert не потрібен).
        const newSlug = dto.slug;
        const newSlugLower = newSlug?.toLowerCase();
        const slugRenaming =
            newSlugLower !== undefined && newSlugLower !== slugLower;
        let renameOwnerId: Types.ObjectId | null = null;
        if (slugRenaming) {
            renameOwnerId = await this.resolveSlugRenameContext(
                newSlugLower,
                slugLower
            );
        }

        // Sprint 7 §7.5 — type-aware cross-checks на UPDATE. PATCH не несе
        // `type` (immutable post-creation, §SP-8); service читає document-
        // resident `type` коли payload містить type-залежні поля. Один read
        // покриває обидва cross-check-и (taxation-applicability + taxId-format-
        // binding) — single round-trip перед write.
        const dtoTouchesTaxation =
            dto.taxationSystem !== undefined || dto.isVatPayer !== undefined;
        const dtoTouchesTaxId = dto.taxId !== undefined;

        if (dtoTouchesTaxation || dtoTouchesTaxId) {
            const existing = await this.businessModel
                .findOne({ slugLower }, { type: 1 })
                .lean<{ type: CreateBusinessRequest['type'] }>()
                .exec();
            if (!existing) {
                throw new NotFoundException({
                    code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
                    message: 'Business not found',
                });
            }
            const existingType = existing.type;

            if (dtoTouchesTaxation && !requiresTaxation(existingType)) {
                // Forward-direction: individual / organization — taxation-поля
                // не застосовуються (включно з `null`-clear, що для immutable-
                // null-стану — bug у клієнті). UX-recovery: видалити поле з
                // PATCH-payload-у.
                throw new BadRequestException({
                    code: RESPONSE_CODE.TAXATION_NOT_APPLICABLE_FOR_TYPE,
                    message:
                        'Taxation fields not applicable for this business type',
                });
            }

            if (
                dtoTouchesTaxation &&
                requiresTaxation(existingType) &&
                (dto.taxationSystem === null || dto.isVatPayer === null)
            ) {
                // Backward-direction: fop / tov — заборонено clear-out (передача
                // null) обов'язкового taxation-поля. null-clear на taxation-
                // required-type створив би invalid stored state
                // (TAXATION_FIELDS_MISMATCH_TYPE у entity-Zod на read). UX-
                // recovery різний від forward-direction-у — окремий код
                // `TAXATION_REQUIRED_FOR_TYPE` ("оберіть систему оподаткування").
                throw new BadRequestException({
                    code: RESPONSE_CODE.TAXATION_REQUIRED_FOR_TYPE,
                    message:
                        'Taxation fields are required for this business type',
                });
            }

            if (
                dto.taxationSystem != null &&
                requiresTaxation(existingType) &&
                !isTaxationAllowedForType(existingType, dto.taxationSystem)
            ) {
                // ПКУ розд. XIV гл. 1 — групи 1/2 єдиного податку доступні лише
                // ФОП. PATCH-DTO Zod не несе `type` (immutable post-creation), тож
                // type-binding `(existingType, dto.taxationSystem)` живе тут.
                // Defense-in-depth для curl-bypass-у frontend-filter-у dropdown-а.
                throw new BadRequestException({
                    code: RESPONSE_CODE.TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE,
                    message:
                        'Taxation system not allowed for this business type',
                });
            }

            if (dtoTouchesTaxId) {
                const newTaxId = dto.taxId!;
                if (!isTaxIdValidForType(existingType, newTaxId)) {
                    throw new BadRequestException({
                        code: RESPONSE_CODE.TAX_ID_FORMAT_MISMATCH_TYPE,
                        message:
                            'Tax id format does not match the business type',
                    });
                }
            }
        }

        // Atomic update + coupled VAT × taxationSystem check у `$expr`-filter
        // — single round-trip у happy path. `$expr` обчислює пару
        // (incoming-or-existing isVatPayer, incoming-or-existing taxationSystem)
        // і блокує update, якщо пара (true, ∉ VAT_ALLOWED_TAXATION_SYSTEMS).
        // Mongo aggregation expression: literal-значення з dto замінює
        // `'$<fieldname>'`-reference на існуюче поле документа.
        const hasCoupledFields =
            dto.isVatPayer !== undefined || dto.taxationSystem !== undefined;

        const filter: FilterQuery<BusinessDocument> = { slugLower };
        if (hasCoupledFields) {
            const nextVat =
                dto.isVatPayer !== undefined ? dto.isVatPayer : '$isVatPayer';
            const nextTax = dto.taxationSystem ?? '$taxationSystem';
            // Coupled invariant: `NOT (nextVat=true AND nextTax ∉ allowed)`.
            // De Morgan → `nextVat ≠ true OR nextTax ∈ allowed` — без `$not`/
            // `$and` nesting, що в aggregation expression потребує масивної
            // форми `{$not:[<expr>]}` і легко спричиняє runtime-помилки.
            filter.$expr = {
                $or: [
                    { $ne: [nextVat, true] },
                    { $in: [nextTax, VAT_ALLOWED_TAXATION_SYSTEMS] },
                ],
            };
        }

        // Sprint 14 — slug-rename вимагає TX (atomic insert у history +
        // update Business + optional revert-cleanup). slugLower additionally
        // у $set для збереження інваріанту `slugLower === slug.toLowerCase()`.
        const setPayload: Record<string, unknown> = { ...dto };
        if (slugRenaming) {
            setPayload.slugLower = newSlugLower!;
            return this.executeSlugRenameUpdate(
                filter,
                setPayload,
                renameOwnerId!,
                slugLower,
                newSlugLower,
                hasCoupledFields
            );
        }

        const updated = await this.businessModel
            .findOneAndUpdate(
                filter,
                { $set: setPayload },
                { new: true, runValidators: true }
            )
            .exec();
        if (updated) return updated;

        // Null = filter не пропустив update. Якщо coupled-fields у dto,
        // розрізняємо 400 (coupled violation) vs 404 (документу немає)
        // одним додатковим `exists()`-запитом — тільки на error-path,
        // happy-path лишається 1-roundtrip.
        if (hasCoupledFields) {
            const exists = await this.businessModel.exists({ slugLower });
            if (exists) {
                throw new BadRequestException({
                    code: RESPONSE_CODE.INVALID_VAT_FOR_TAXATION_SYSTEM,
                    message:
                        'Платник ПДВ дозволений лише на спрощеній-3 або загальній системі',
                });
            }
        }
        throw new NotFoundException({
            code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
            message: 'Business disappeared between guard and update',
        });
    }

    /**
     * Sprint 14 — pre-write resolve для slug-rename. Робить **один** lookup
     * на owner-doc (повертає `_id`), потім паралельно перевіряє:
     *  - reserved-список (роуты апки) — sync;
     *  - cross-business clash у Business.slugLower;
     *  - cross-business clash у History.slugLower (`businessId: $ne ownerId`,
     *    self-history дозволено для revert-сценарію).
     *
     * `ownerId` далі передається у TX-flow → дозволяє пропустити повторний
     * findOne всередині транзакції (раніше один і той же документ читався
     * двічі на happy-path slug-rename).
     *
     * Race-window між цим check-ом і TX-write закриває 11000 на history
     * unique-індексі — concurrent rename на той самий slug дає один success
     * + один `SLUG_TAKEN` через duplicate-key handling у `executeSlugRenameUpdate`.
     */
    private async resolveSlugRenameContext(
        newLower: string,
        oldLower: string
    ): Promise<Types.ObjectId> {
        if (this.slugGenerator.isReserved(newLower)) {
            throw new BadRequestException({
                code: RESPONSE_CODE.SLUG_RESERVED,
                message: 'Slug is reserved by the system',
            });
        }
        const owner = await this.businessModel
            .findOne({ slugLower: oldLower }, { _id: 1 })
            .lean<{ _id: Types.ObjectId }>()
            .exec();
        if (!owner) {
            throw new NotFoundException({
                code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
                message: 'Business not found',
            });
        }
        // Поточний бізнес сидить на `oldLower`, ми перевіряємо `newLower !==
        // oldLower` — будь-який hit на Business завжди cross-business.
        // Self-history не блокує (revert-flow видалить запис всередині TX).
        const [businessClash, historyClash] = await Promise.all([
            this.businessModel.exists({ slugLower: newLower }),
            this.historyModel.exists({
                slugLower: newLower,
                businessId: { $ne: owner._id },
            }),
        ]);
        if (businessClash) {
            throw new ConflictException({
                code: RESPONSE_CODE.SLUG_TAKEN,
                message: 'Slug already taken by another business',
            });
        }
        if (historyClash) {
            throw new ConflictException({
                code: RESPONSE_CODE.SLUG_TAKEN,
                message:
                    'Slug is reserved by recent rename of another business',
            });
        }
        return owner._id;
    }

    /**
     * TX-обгортка для slug-rename:
     *  1. Delete self-history-entry з `slugLower === newLower` (revert
     *     `abc → xyz → abc` дозволяє ре-claim без чекати TTL 90 днів).
     *  2. Insert старий slug у history (anti-squatting + 308-redirect grace).
     *  3. `findOneAndUpdate` на Business з `$expr`-filter (coupled VAT)
     *     і `$set` з новими `slug + slugLower + …rest`.
     *
     * `businessId` приходить з pre-write `resolveSlugRenameContext` —
     * другий findOne всередині TX не робиться. Concurrent delete між pre-
     * write і TX закриває `findOneAndUpdate` null → throw → TX rollback.
     *
     * **11000-handling:**
     *  - На `history.slugLower` unique: race з concurrent rename на той самий
     *    slug. Мапаємо у `SLUG_TAKEN`.
     *  - На `business.slugLower` unique: race з паралельним rename інакого
     *    бізнесу або create-у на цей slug. Теж `SLUG_TAKEN`.
     */
    private async executeSlugRenameUpdate(
        filter: FilterQuery<BusinessDocument>,
        setPayload: Record<string, unknown>,
        businessId: Types.ObjectId,
        oldLower: string,
        newLower: string,
        hasCoupledFields: boolean
    ): Promise<BusinessDocument> {
        const session = await this.connection.startSession();
        try {
            let updated: BusinessDocument | null = null;
            await session.withTransaction(async () => {
                updated = await this.runSlugRenameInsideTx(
                    filter,
                    setPayload,
                    businessId,
                    oldLower,
                    hasCoupledFields,
                    session
                );
            });
            // `updated` встановлюється всередині callback-а. Якщо TX не
            // throw-нула, updated завжди non-null (helper throws на null-шляхах).
            return updated!;
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                throw new ConflictException({
                    code: RESPONSE_CODE.SLUG_TAKEN,
                    message: 'Slug already taken by another business',
                });
            }
            if (isTransactionsUnsupportedError(err)) {
                this.logger.error(
                    `Slug rename failed: replica-set required. oldLower=${oldLower} newLower=${newLower}. Original: ${
                        err instanceof Error ? err.message : String(err)
                    }`
                );
                throw new InternalServerErrorException({
                    code: RESPONSE_CODE.TRANSACTION_REQUIRES_REPLICA_SET,
                    message:
                        'Slug rename requires Mongo replica-set; check MONGODB_URI',
                });
            }
            throw err;
        } finally {
            await session.endSession();
        }
    }

    private async runSlugRenameInsideTx(
        filter: FilterQuery<BusinessDocument>,
        setPayload: Record<string, unknown>,
        businessId: Types.ObjectId,
        oldLower: string,
        hasCoupledFields: boolean,
        session: ClientSession
    ): Promise<BusinessDocument> {
        const newLower = setPayload.slugLower as string;

        // Revert-flow: дозволяємо `abc → xyz → abc`, не блокуючи self-history.
        await this.historyModel
            .deleteMany({ businessId, slugLower: newLower }, { session })
            .exec();

        await this.historyModel.create([{ businessId, slugLower: oldLower }], {
            session,
        });

        const updated = await this.businessModel
            .findOneAndUpdate(
                filter,
                { $set: setPayload },
                { new: true, runValidators: true, session }
            )
            .exec();
        if (updated) return updated;

        // Filter не пропустив update. Або coupled-VAT, або concurrent delete
        // між pre-write resolve і цією TX. Для diagnostics різні error-коди.
        if (hasCoupledFields) {
            throw new BadRequestException({
                code: RESPONSE_CODE.INVALID_VAT_FOR_TAXATION_SYSTEM,
                message:
                    'Платник ПДВ дозволений лише на спрощеній-3 або загальній системі',
            });
        }
        throw new NotFoundException({
            code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
            message: 'Business disappeared between resolve and update',
        });
    }

    /**
     * Sprint 3 рішення C2 + Sprint 4 SP-5: hard-delete з cascade-видаленням
     * усіх інвойсів бізнесу **atomic-or-nothing через `withTransaction`**.
     *
     * **Інваріант atomic-or-nothing.** Mongo transaction гарантує, що або
     * (а) видалено і бізнес, і всі його інвойси, або (б) нічого не видалено.
     *
     * **Орфан-prevention з concurrent-create-ом** (Sprint 4 review fix).
     * Раніше тут стверджувалось, що orphan-state "неможливий" — це було
     * завищена гарантія: cascade-delete рaн всередині транзакції, але
     * `InvoicesService.create` йшов поза транзакцією і не координувався з
     * delete-ом. Сценарій: TX-Delete видаляє invoices та business; concurrent
     * `create` уже пройшов guard-read (бізнес ще був), а insert вставляється
     * після `deleteMany(invoices)` і до commit-у delete-у — orphan invoice.
     *
     * Фікс: `InvoicesService.create` тепер теж тримає транзакцію і **touches**
     * business (`updateOne $currentDate: updatedAt`) у ній. Mongo write-write
     * conflict serialize-ить два TX: або create-touch виграє і delete-у
     * retry'неться (deleteMany побачить новий invoice і видалить його), або
     * delete-у виграє і create-touch на retry побачить matchedCount=0 →
     * 404 BUSINESS_NOT_FOUND, без orphan-insert-у.
     *
     * **Mongo replica-set requirement.** `withTransaction` працює лише на
     * replica-set; на standalone mongod кидає `MongoServerError` з message
     * "Transaction numbers are only allowed on a replica set". Sprint 4 §4.0
     * перевів production-Mongo (Atlas) і test-suite (`MongoMemoryReplSet`)
     * на replica-set; dev — три documented шляхи у root README. На
     * misconfigured infra ми ловимо помилку і кидаємо
     * `TRANSACTION_REQUIRES_REPLICA_SET` 500 — жодного `delete` не
     * виконано, ніяких orphan-invoices не дозволяємо.
     *
     * **Pre-count поза транзакцією.** План §4.0 §SP-5: count для
     * affectedInvoices у response — інформативний, не критичний для atomic-
     * інваріанту. Якщо invoice створено між count і deleteMany — count
     * у toast буде stale на 1, але atomic-or-nothing все одно гарантує
     * відсутність orphan-state-у.
     *
     * **Idempotent delete.** Якщо business зник між guard і delete (race з
     * паралельним delete-ом) — `deleteOne` тихо повертає 0 deletedCount,
     * ми все одно повертаємо `affectedInvoices` (можливо 0). Frontend бачить
     * success-toast, що correct semantically: бізнесу нема — мета досягнута.
     */
    async delete(
        business: BusinessDocument
    ): Promise<{ affectedAccounts: number; affectedInvoices: number }> {
        const businessId = business._id;
        // Pre-count counters — informative для response toast. Stale by ~tick
        // на concurrent-create-у не блокує atomic-or-nothing invariant.
        const [affectedAccounts, affectedInvoices] = await Promise.all([
            this.accountModel.countDocuments({ businessId }),
            this.invoiceModel.countDocuments({ businessId }),
        ]);

        const session = await this.connection.startSession();
        try {
            await session.withTransaction(async () => {
                // Sprint 9 §SP-5 + Sprint 14: cascade чотири collections +
                // business у тій самій TX. Atomic-or-nothing.
                //
                // **`historyModel.deleteMany`** (Sprint 14) — без cleanup-у
                // rename-history-entries деактивованого бізнесу залишилися б
                // живими до TTL 90 днів. Наслідки: (а) slug блокувався б у
                // anti-squatting check для інших юзерів, (б)
                // `getBySlugOrHistorical` робив би "history-hit → findById →
                // null" 2-query orphan-lookup на кожен public hit
                // `pay/{deletedSlug}`. Anti-impersonation після delete — окрема
                // фіча з власною семантикою, не побічний ефект rename-history;
                // банк-апі рендерить payee name з QR-payload, customer бачить
                // mismatch і відхиляє платіж.
                await this.invoiceModel.deleteMany({ businessId }, { session });
                await this.accountModel.deleteMany({ businessId }, { session });
                await this.counterModel.deleteMany({ businessId }, { session });
                await this.historyModel.deleteMany({ businessId }, { session });
                // Sprint 15 — nested slug-history (account + invoice rename
                // history) теж чистимо у тій самій TX. Без cleanup-у вони
                // блокували б slug у anti-squatting + давали б orphan
                // history-hit lookup-и на public hits після delete.
                await this.accountHistoryModel.deleteMany(
                    { businessId },
                    { session }
                );
                await this.invoiceHistoryModel.deleteMany(
                    { businessId },
                    { session }
                );
                await this.businessModel.deleteOne(
                    { _id: businessId },
                    { session }
                );
            });
        } catch (err) {
            if (isTransactionsUnsupportedError(err)) {
                this.logger.error(
                    `Cascade delete failed: replica-set required. Business ${businessId.toString()}. Original error: ${
                        err instanceof Error ? err.message : String(err)
                    }`
                );
                throw new InternalServerErrorException({
                    code: RESPONSE_CODE.TRANSACTION_REQUIRES_REPLICA_SET,
                    message:
                        'Cascade delete requires Mongo replica-set; check MONGODB_URI',
                });
            }
            throw err;
        } finally {
            await session.endSession();
        }

        return { affectedAccounts, affectedInvoices };
    }
}

function isDuplicateKeyError(err: unknown): err is Error & { code: number } {
    return (
        err instanceof Error &&
        'code' in err &&
        (err as { code: unknown }).code === 11000
    );
}

function readKeyPattern(err: unknown): Record<string, number> {
    if (err && typeof err === 'object' && 'keyPattern' in err) {
        const kp = (err as { keyPattern?: unknown }).keyPattern;
        if (kp && typeof kp === 'object') {
            return kp as Record<string, number>;
        }
    }
    return {};
}
