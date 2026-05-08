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
    type BusinessWithInvoicesCount,
    type CreateBusinessRequest,
    type UpdateBusinessRequest,
} from '@finly/types';

import { isTransactionsUnsupportedError } from '../../common/mongoose/transactions-unsupported';
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

        try {
            return await this.businessModel.create({
                ...dto,
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
     * Sprint 4 §4.4 — list з `invoicesCount` per item у **одному round-trip**
     * (single aggregation pipeline, не N+1).
     *
     * **`$lookup` + nested `$count`-pipeline.** Default-варіант
     * `from/localField/foreignField` повертає повні invoice-документи, після
     * чого ми робили б `$size` — memory-hungry на businesses з 100+ інвойсів.
     * Nested-pipeline з `$count`-stage повертає одне число замість масиву
     * документів — індексний read через `(businessId, createdAt)` index без
     * read-fan-out-у документів.
     *
     * **Повертає plain-objects (aggregate output), не Mongoose-документи.**
     * Aggregate output не проходить через Mongoose `toJSON`-transform, тож
     * `_id → id`-mapping робиться прямо у pipeline (`$addFields` +
     * `$unset`) — output shape матчить `Business`-entity (`id: string`,
     * без `_id`/`__v`). Return-type — `BusinessWithInvoicesCount`
     * (`Business & { invoicesCount }`), а не `BusinessDocument & ...` —
     * чесний контракт: caller не може покликати document-методи (`.save()`,
     * `.toJSON()`) на plain-object-i.
     */
    async getOwnedAndManagedWithInvoicesCount(
        userId: string,
        isBookkeeperMode: boolean
    ): Promise<BusinessWithInvoicesCount[]> {
        const userObjectId = new Types.ObjectId(userId);
        const matchFilter = isBookkeeperMode
            ? { ownerId: null, managers: userObjectId }
            : { ownerId: userObjectId };
        const result = await this.businessModel
            .aggregate([
                { $match: matchFilter },
                {
                    $lookup: {
                        from: 'invoices',
                        let: { bid: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $eq: ['$businessId', '$$bid'],
                                    },
                                },
                            },
                            { $count: 'count' },
                        ],
                        as: '__invoicesCount',
                    },
                },
                {
                    $addFields: {
                        invoicesCount: {
                            $ifNull: [
                                {
                                    $arrayElemAt: ['$__invoicesCount.count', 0],
                                },
                                0,
                            ],
                        },
                        // Mongoose toJSON-transform не виконується для
                        // aggregate-output. Робимо `_id → id`-mapping
                        // explicitly у pipeline.
                        id: { $toString: '$_id' },
                        // Sprint 4 §4.1 — `invoiceSlugPresetDefault` додане
                        // після первинної BusinessSchema (May 6). Mongoose
                        // `default: null` спрацьовує лише на insert; legacy-
                        // документи (створені до May 6) мають це поле
                        // відсутнім у БД. `findOne`-path викликає Mongoose
                        // doc-init, який attach-ить default; aggregation
                        // bypass-ить Mongoose повністю → undefined leak до
                        // frontend-у. `BusinessWithInvoicesCount` контракт
                        // вимагає `SlugPreset | null` (NOT undefined) —
                        // нормалізуємо тут, щоб aggregation і `getBySlug`
                        // повертали той самий shape.
                        invoiceSlugPresetDefault: {
                            $ifNull: ['$invoiceSlugPresetDefault', null],
                        },
                    },
                },
                { $unset: ['__invoicesCount', '_id', '__v'] },
                { $sort: { createdAt: -1 } },
            ])
            .exec();
        return result as BusinessWithInvoicesCount[];
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
        // Atomic update + coupled VAT × taxationSystem check у `$expr`-filter
        // — single round-trip у happy path. `$expr` обчислює пару
        // (incoming-or-existing isVatPayer, incoming-or-existing taxationSystem)
        // і блокує update, якщо пара (true, ∉ VAT_ALLOWED_TAXATION_SYSTEMS).
        // Mongo aggregation expression: literal-значення з dto замінює
        // `'$<fieldname>'`-reference на існуюче поле документа.
        const slugLower = slug.toLowerCase();
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
     * `CASCADE_DELETE_REQUIRES_REPLICA_SET` 500 — жодного `delete` не
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
    ): Promise<{ affectedInvoices: number }> {
        const businessId = business._id;
        const affectedInvoices = await this.invoiceModel.countDocuments({
            businessId,
        });

        const session = await this.connection.startSession();
        try {
            await session.withTransaction(async () => {
                await this.invoiceModel.deleteMany({ businessId }, { session });
                // Sprint 4 review fix — cascade-видалення counter-doc-ів того
                // самого business-у. Без цього counter-доки залишалися б
                // orphan-ами per business _id з-під видаленого бізнесу
                // (нешкідливо для коректності, бо _id unique і не reuse-ається,
                // але засмічує колекцію). Атомарно у тій самій TX-сесії —
                // якщо TX abort-ить, counters лишаються разом з invoices.
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
                    code: RESPONSE_CODE.CASCADE_DELETE_REQUIRES_REPLICA_SET,
                    message:
                        'Cascade delete requires Mongo replica-set; check MONGODB_URI',
                });
            }
            throw err;
        } finally {
            await session.endSession();
        }

        return { affectedInvoices };
    }
}
