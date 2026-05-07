import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types, type FilterQuery } from 'mongoose';
import {
    RESPONSE_CODE,
    type CreateInvoiceRequest,
    type UpdateInvoiceRequest,
} from '@finly/types';

import { isTransactionsUnsupportedError } from '../../common/mongoose/transactions-unsupported';
import {
    Business,
    type BusinessDocument,
} from '../businesses/schemas/business.schema';
import { InvoiceSlugGeneratorService } from './invoice-slug-generator.service';
import { Invoice, InvoiceDocument } from './schemas/invoice.schema';

export interface PaginationParams {
    page: number;
    limit: number;
}

export interface PaginatedInvoices {
    items: InvoiceDocument[];
    total: number;
    page: number;
    limit: number;
}

/**
 * Sprint 4 §4.2 — primary CRUD service для invoice cabinet-зони.
 *
 * **Slug-case asymmetry vs business** (SP-8): invoice-slug — `case-sensitive`
 * lookup (на відміну від business-slug, що case-insensitive). У 99% кейсів
 * invoice-slug system-generated, тож phantom value у case-insensitive lookup
 * = 0; жодного `slugLower` parallel-field, жодного 308-redirect.
 *
 * **Coupled `amount=null + amountLocked=true` cross-field check у `update`**:
 * write-DTO Zod refine активний лише якщо передано **обидва** поля одного
 * PATCH-у. Sprint 3 §3.2 inline-edit-pattern (`isVatPayer` / `taxationSystem`)
 * у Business-update робить cross-field перевірку через `$expr`-filter у
 * `findOneAndUpdate` — single round-trip у happy path. Той самий pattern
 * використовуємо тут.
 *
 * **`create` retry-on-11000** (SP-1 risk #2 mitigation): `(businessId, slug)`
 * compound-unique + partial-unique `(businessId, slugCounterScope, slugCounter)`
 * блокують race-collision; якщо паралельний insert виграв counter — наш падає
 * на `code: 11000`, ловимо і retry generate (3 спроби). Без partial-unique
 * compound-index-у (Sprint 4 §4.1) retry був би неефективний — два інвойси
 * `inv-001-...` з різними tails ніколи б не conflicted на `(businessId, slug)`.
 */
@Injectable()
export class InvoicesService {
    private readonly logger = new Logger(InvoicesService.name);
    private static readonly CREATE_MAX_RETRIES = 3;

    constructor(
        @InjectModel(Invoice.name)
        private readonly invoiceModel: Model<InvoiceDocument>,
        @InjectModel(Business.name)
        private readonly businessModel: Model<BusinessDocument>,
        @InjectConnection()
        private readonly connection: Connection,
        private readonly slugGenerator: InvoiceSlugGeneratorService
    ) {}

    /**
     * Sprint 4 §4.2 — invoice create з двома незалежними race-protections.
     *
     *  1) **Orphan-prevention vs concurrent cascade-delete** (Sprint 4 review
     *     fix). Без координації між create і `BusinessesService.delete` існує
     *     race-window: TX-Delete видаляє invoices+business; concurrent create
     *     уже пройшов `BusinessAccessGuard`-read, а insert вставляється
     *     після `deleteMany(invoices)` і до commit-у delete-у — orphan
     *     invoice з валідним `businessId`-у-вже-видаленого-business-у.
     *
     *     Фікс: один insert-attempt живе всередині `withTransaction`. Перший
     *     крок — touch business (`updateOne $currentDate: { updatedAt: true }`)
     *     у тій самій сесії: створює write-intent на business document, Mongo
     *     write-write-conflict-detection serialize-ить два TX. Якщо delete
     *     виграв race — touch повертає `matchedCount=0` → 404
     *     `BUSINESS_NOT_FOUND`, без orphan insert-у.
     *
     *  2) **Slug-collision retry (counter-race у preset-scope-ах)** — окрема
     *     **зовнішня** loop, кожна спроба — нова session/transaction.
     *
     *     Чому НЕ всередині однієї транзакції (refixed after second review):
     *     `DuplicateKeyError` (11000) у Mongo транзакції aborts її
     *     server-side; будь-який наступний write у тій самій сесії падає
     *     з `TransactionAborted`, не з повторного 11000. Outer loop з fresh
     *     session-ом обходить це: на 11000 `withTransaction` re-throws до
     *     нас, ловимо у каркасі і відкриваємо новий transaction. Slug-
     *     generator на retry читає вже-committed counter-state і генерує
     *     N+1.
     *
     *     Cost: 11000 → нова session/TX. Counter-collision rare у normal
     *     load; tail-collision (8-char × 62-alphabet, ~218T комбінацій) —
     *     астрономічно рідкісний → MAX_RETRIES=3 захищає від edge cases.
     *
     * **Replica-set requirement.** Той самий гард, що `BusinessesService.delete`:
     * на standalone mongod ловимо `Transaction numbers are only allowed on a
     * replica set` і кидаємо `CASCADE_DELETE_REQUIRES_REPLICA_SET` 500.
     * Reuse `isTransactionsUnsupportedError`-helper з `common/mongoose`.
     */
    async create(
        business: BusinessDocument,
        dto: CreateInvoiceRequest
    ): Promise<InvoiceDocument> {
        // Sprint 4 review fix — `validUntil >= now` enforce-имо тут (write-
        // side); raison-d'etre у doc-блоці на схемі. Перевіряємо ДО старту
        // транзакції, щоб 400-error не запускав session machinery.
        assertValidUntilNotInPast(dto.validUntil);

        let lastError: unknown;
        for (
            let attempt = 1;
            attempt <= InvoicesService.CREATE_MAX_RETRIES;
            attempt++
        ) {
            try {
                return await this.createOneAttempt(business, dto);
            } catch (err) {
                if (isDuplicateKeyError(err)) {
                    lastError = err;
                    this.logger.warn(
                        `Invoice insert attempt ${attempt}/${InvoicesService.CREATE_MAX_RETRIES} hit duplicate-key; retrying with fresh session for business ${business._id.toString()}`
                    );
                    continue;
                }
                throw err;
            }
        }
        this.logger.error(
            `Failed to create invoice for business ${business._id.toString()} after ${InvoicesService.CREATE_MAX_RETRIES} retries; last error: ${
                lastError instanceof Error
                    ? lastError.message
                    : String(lastError)
            }`
        );
        throw new InternalServerErrorException({
            code: RESPONSE_CODE.INVOICE_SLUG_GENERATION_FAILED,
            message:
                'Failed to create invoice after retries due to slug collision',
        });
    }

    /**
     * Один insert-attempt: новa session + transaction + touch business +
     * generate slug + insert invoice. Будь-які помилки propagate назовні
     * до `create()`, який вирішує retry (тільки на 11000) чи throw.
     *
     * Slug-generator виноситься всередину callback-у `withTransaction`
     * (без session — читає committed snapshot), щоб на кожен fresh attempt
     * перерахувати counter — захист від counter-race з паралельним insert-ом.
     */
    private async createOneAttempt(
        business: BusinessDocument,
        dto: CreateInvoiceRequest
    ): Promise<InvoiceDocument> {
        const session = await this.connection.startSession();
        try {
            let created: InvoiceDocument | undefined;
            await session.withTransaction(async () => {
                // Touch business у тій самій сесії — створює write-intent на
                // business document; concurrent cascade-delete deleteOne на
                // тому самому _id тригерить write-conflict (Mongo abort-ить
                // одну з TX, withTransaction робить retry автоматично через
                // TransientTransactionError-label).
                const touch = await this.businessModel
                    .updateOne(
                        { _id: business._id },
                        { $currentDate: { updatedAt: true } },
                        { session }
                    )
                    .exec();
                if (touch.matchedCount === 0) {
                    // Cascade-delete виграв race: business більше нема.
                    // NotFoundException не має TransientTransactionError-
                    // label-у, тож withTransaction abort-ить TX і re-throw-ить
                    // до нас. Outer-loop у `create()` НЕ retry-ить такі
                    // помилки (тільки 11000) — кидаємо назовні.
                    throw new NotFoundException({
                        code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
                        message: 'Business deleted during invoice creation',
                    });
                }
                const slugInfo = await this.slugGenerator.generateInvoiceSlug({
                    businessId: business._id,
                    slugInput: dto.slugInput,
                    paymentPurpose: dto.paymentPurpose,
                    businessPaymentPurposeTemplate:
                        business.paymentPurposeTemplate,
                });
                const docs = await this.invoiceModel.create(
                    [
                        {
                            businessId: business._id,
                            slug: slugInfo.slug,
                            amount: dto.amount,
                            amountLocked: dto.amountLocked,
                            paymentPurpose: dto.paymentPurpose,
                            validUntil: dto.validUntil,
                            slugPreset: slugInfo.slugPreset,
                            slugCounterScope: slugInfo.slugCounterScope,
                            slugCounter: slugInfo.slugCounter,
                        },
                    ],
                    { session }
                );
                created = docs[0]!;
            });
            // `withTransaction` resolve-иться після успішного commit-у. `created`
            // обовʼязково присвоєний — або callback заповнив, або кинув.
            return created!;
        } catch (err) {
            if (isTransactionsUnsupportedError(err)) {
                this.logger.error(
                    `Invoice create failed: replica-set required. Business ${business._id.toString()}. Original: ${
                        err instanceof Error ? err.message : String(err)
                    }`
                );
                throw new InternalServerErrorException({
                    code: RESPONSE_CODE.CASCADE_DELETE_REQUIRES_REPLICA_SET,
                    message:
                        'Invoice create requires Mongo replica-set; check MONGODB_URI',
                });
            }
            throw err;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Paginated list для cabinet секції "Рахунки" (§4.4). Sort `createdAt
     * desc` — найновіші зверху, як у списку бізнесів Sprint 3.
     *
     * **`_id: -1` як tie-breaker** (review fix). `createdAt`-only-sort був
     * non-deterministic: два інвойси з ідентичним millisecond-timestamp
     * (bulk-import, batch-create через тести, або race-create під одним
     * пресетом) поверталися у не-визначеному порядку, що для offset-pagination
     * викликало два регреси на frontend-i:
     *
     *   1. **Дублі**: page=1 і page=2 могли перетнути той самий tie-group по-
     *      різному, повертаючи один і той самий інвойс на обох сторінках.
     *      `mergeUniqueById` ховає дублі у UI, але це маскування симптому.
     *   2. **Пропуски**: інвойс з tie-group міг "перестрибнути" через page-
     *      boundary між послідовними fetch-ами і ніколи не з'явитись у UI —
     *      даних немає як відновити (frontend-merge не може повернути те,
     *      чого не отримав).
     *
     * `_id` за ObjectId-структурою монотонно росте у межах того самого
     * timestamp-у (counter+random+pid), тож `(createdAt: -1, _id: -1)` дає
     * total order без необхідності у cursor-pagination.
     *
     * `total` повертається разом з items, щоб frontend "Завантажити ще"-trigger
     * знав, коли зупинятись (без зайвого round-trip-у).
     */
    async getByBusinessId(
        businessId: Types.ObjectId,
        pagination: PaginationParams
    ): Promise<PaginatedInvoices> {
        const { page, limit } = pagination;
        const skip = (page - 1) * limit;
        const [items, total] = await Promise.all([
            this.invoiceModel
                .find({ businessId })
                .sort({ createdAt: -1, _id: -1 })
                .skip(skip)
                .limit(limit)
                .exec(),
            this.invoiceModel.countDocuments({ businessId }),
        ]);
        return { items, total, page, limit };
    }

    /**
     * Cheap aggregate для cabinet `getBySlug`-extension (`invoicesCount`) і
     * delete-confirm warning. Index `(businessId, createdAt)` (Sprint 1)
     * покриває фільтр через prefix-match.
     */
    async countByBusinessId(businessId: Types.ObjectId): Promise<number> {
        return this.invoiceModel.countDocuments({ businessId });
    }

    /**
     * Compound-keyed lookup `(businessId, slug)` — case-sensitive (SP-8).
     * `null` повертається якщо не знайдено — caller (`InvoiceAccessGuard`)
     * вирішує, як перетворити на 404.
     */
    async getBySlug(
        businessId: Types.ObjectId,
        invoiceSlug: string
    ): Promise<InvoiceDocument | null> {
        return this.invoiceModel
            .findOne({ businessId, slug: invoiceSlug })
            .exec();
    }

    /**
     * Atomic update + coupled `amount × amountLocked` cross-field check у
     * `$expr`-filter (Sprint 3 §3.2 pattern). Single round-trip у happy path.
     *
     * Coupled-rule: NOT (next.amount === null AND next.amountLocked === true).
     * De Morgan → next.amount !== null OR next.amountLocked !== true.
     */
    async update(
        businessId: Types.ObjectId,
        invoiceSlug: string,
        dto: UpdateInvoiceRequest
    ): Promise<InvoiceDocument> {
        // Sprint 4 review fix — той самий invariant, що у create. PATCH без
        // `validUntil` пропускаємо (`undefined` = поле не зачіпають), `null`
        // — explicit "без терміну дії", дозволено. Перевіряємо тільки коли
        // приходить Date.
        if (dto.validUntil !== undefined) {
            assertValidUntilNotInPast(dto.validUntil);
        }
        const filter: FilterQuery<InvoiceDocument> = {
            businessId,
            slug: invoiceSlug,
        };
        const hasCoupledFields =
            dto.amount !== undefined || dto.amountLocked !== undefined;
        if (hasCoupledFields) {
            const nextAmount =
                dto.amount !== undefined ? dto.amount : '$amount';
            const nextLocked =
                dto.amountLocked !== undefined
                    ? dto.amountLocked
                    : '$amountLocked';
            filter.$expr = {
                $or: [{ $ne: [nextAmount, null] }, { $ne: [nextLocked, true] }],
            };
        }

        const updated = await this.invoiceModel
            .findOneAndUpdate(
                filter,
                { $set: dto },
                { new: true, runValidators: true }
            )
            .exec();
        if (updated) return updated;

        // Filter не пропустив update. Розрізняємо 400 (coupled violation) vs
        // 404 одним додатковим `exists`-запитом — тільки на error-path.
        if (hasCoupledFields) {
            const exists = await this.invoiceModel.exists({
                businessId,
                slug: invoiceSlug,
            });
            if (exists) {
                throw new BadRequestException({
                    code: RESPONSE_CODE.INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT,
                    message:
                        'Заблокувати редагування суми можна лише при заданій сумі',
                });
            }
        }
        throw new NotFoundException({
            code: RESPONSE_CODE.INVOICE_NOT_FOUND,
            message: 'Invoice disappeared between guard and update',
        });
    }

    /**
     * Hard-delete (Sprint 3 рішення C2 — той самий pattern для invoice). 5s
     * frontend-Undo живе на web-стороні як optimistic UI; цей method
     * виконується тільки якщо timer пройшов без cancel-у. Idempotent: повторне
     * delete не падає (race з паралельним delete-ом — тихо OK).
     */
    async delete(
        businessId: Types.ObjectId,
        invoiceSlug: string
    ): Promise<void> {
        const result = await this.invoiceModel
            .deleteOne({ businessId, slug: invoiceSlug })
            .exec();
        if (result.deletedCount === 0) {
            throw new NotFoundException({
                code: RESPONSE_CODE.INVOICE_NOT_FOUND,
                message: 'Invoice not found during delete',
            });
        }
    }
}

/**
 * MongoServerError code 11000 = duplicate key. Може приходити як з
 * `(businessId, slug)` compound-unique (slug-tail collision — астрономічно
 * рідкісне) або з `(businessId, slugCounterScope, slugCounter)` partial-unique
 * (counter-race — Sprint 4 §4.1). Обробляємо однаково — retry generate.
 */
function isDuplicateKeyError(err: unknown): boolean {
    return (
        err instanceof Error &&
        'code' in err &&
        (err as { code: unknown }).code === 11000
    );
}

/**
 * Sprint 4 review fix — write-side інваріант `validUntil >= now`. `null`
 * (без терміну дії) пропускається без перевірки.
 *
 * **Boundary semantic.** `validUntil === Date.now()` приймається — точка-у-now
 * ще active (дзеркало `isInvoiceExpired` server-side і `getInvoiceStatus`
 * frontend). Перехід у "минуле" — на наступній millisecond-tick.
 */
function assertValidUntilNotInPast(validUntil: Date | null): void {
    if (validUntil === null) return;
    if (validUntil.getTime() < Date.now()) {
        throw new BadRequestException({
            code: RESPONSE_CODE.INVOICE_VALID_UNTIL_IN_PAST,
            // Server message — fallback log; user-facing UA-рядок mapApiCode
            // на frontend (`invoice_valid_until_in_past` ключ).
            message: 'validUntil cannot be in the past',
        });
    }
}
