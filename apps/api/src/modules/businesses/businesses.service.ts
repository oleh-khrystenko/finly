import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    Logger,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types, type FilterQuery } from 'mongoose';
import {
    RESPONSE_CODE,
    VAT_ALLOWED_TAXATION_SYSTEMS,
    isTaxIdValidForType,
    requiresTaxation,
    type BusinessWithCounts,
    type CreateBusinessRequest,
    type UpdateBusinessRequest,
} from '@finly/types';

import { isTransactionsUnsupportedError } from '../../common/mongoose/transactions-unsupported';
import {
    Account,
    type AccountDocument,
} from '../accounts/schemas/account.schema';
import {
    InvoiceSlugCounter,
    type InvoiceSlugCounterDocument,
} from '../invoices/schemas/invoice-slug-counter.schema';
import {
    Invoice,
    type InvoiceDocument,
} from '../invoices/schemas/invoice.schema';
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
        @InjectModel(Account.name)
        private readonly accountModel: Model<AccountDocument>,
        @InjectModel(Invoice.name)
        private readonly invoiceModel: Model<InvoiceDocument>,
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
        const slug = await this.slugGenerator.generateRandomSlug();

        const ownership = isBookkeeperMode
            ? { ownerId: null, managers: [userObjectId] }
            : { ownerId: userObjectId, managers: [] as Types.ObjectId[] };

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
            // Race condition: SlugGenerator щойно перевірив `slugLower` як
            // вільний, але паралельний create зайняв його раніше за наш
            // insert. Для 8-char × 62-alphabet алфавіту вірогідність ≈ 0,
            // але defensively ловимо MongoServerError 11000 і кидаємо
            // SLUG_GENERATION_FAILED з логом — це сигнал для алерту, не
            // user-facing помилка.
            if (
                err instanceof Error &&
                'code' in err &&
                (err as { code: number }).code === 11000
            ) {
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
     */
    async getBySlug(slug: string): Promise<BusinessDocument | null> {
        return this.businessModel
            .findOne({ slugLower: slug.toLowerCase() })
            .exec();
    }

    async update(
        slug: string,
        dto: UpdateBusinessRequest
    ): Promise<BusinessDocument> {
        const slugLower = slug.toLowerCase();

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

        const updated = await this.businessModel
            .findOneAndUpdate(
                filter,
                { $set: dto },
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
                // Sprint 9 §SP-5 cascade — три collections + business у тій
                // самій TX. Atomic-or-nothing: або повністю, або нічого.
                await this.invoiceModel.deleteMany(
                    { businessId },
                    { session }
                );
                await this.accountModel.deleteMany(
                    { businessId },
                    { session }
                );
                await this.counterModel.deleteMany(
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
