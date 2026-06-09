import {
    BadRequestException,
    ConflictException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types, type FilterQuery } from 'mongoose';
import {
    RESPONSE_CODE,
    type AccessLevel,
    type AutoSlugMode,
    type CreateInvoiceRequest,
    type SlugInput,
    type UpdateInvoiceRequest,
} from '@finly/types';

import { assertSlugEditAllowed } from '../../common/billing/assert-access';
import { isTransactionsUnsupportedError } from '../../common/mongoose/transactions-unsupported';
import {
    Account,
    type AccountDocument,
} from '../accounts/schemas/account.schema';
import type { BusinessDocument } from '../businesses/schemas/business.schema';
import { InvoiceSlugGeneratorService } from './invoice-slug-generator.service';
import { effectiveInvoicePurpose } from './purpose-resolver';
import {
    InvoiceSlugHistory,
    InvoiceSlugHistoryDocument,
} from './schemas/invoice-slug-history.schema';
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
        @InjectModel(InvoiceSlugHistory.name)
        private readonly historyModel: Model<InvoiceSlugHistoryDocument>,
        @InjectModel(Account.name)
        private readonly accountModel: Model<AccountDocument>,
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
     * replica set` і кидаємо `TRANSACTION_REQUIRES_REPLICA_SET` 500.
     * Reuse `isTransactionsUnsupportedError`-helper з `common/mongoose`.
     */
    async create(
        business: BusinessDocument,
        account: AccountDocument,
        dto: CreateInvoiceRequest
    ): Promise<InvoiceDocument> {
        // Sprint 4 review fix — `validUntil >= now` enforce-имо тут (write-
        // side). Перевіряємо ДО старту транзакції.
        assertValidUntilNotInPast(dto.validUntil);

        let lastError: unknown;
        for (
            let attempt = 1;
            attempt <= InvoicesService.CREATE_MAX_RETRIES;
            attempt++
        ) {
            try {
                return await this.createOneAttempt(business, account, dto);
            } catch (err) {
                if (isDuplicateKeyError(err)) {
                    lastError = err;
                    this.logger.warn(
                        `Invoice insert attempt ${attempt}/${InvoicesService.CREATE_MAX_RETRIES} hit duplicate-key; retrying with fresh session for account ${account._id.toString()}`
                    );
                    continue;
                }
                throw err;
            }
        }
        this.logger.error(
            `Failed to create invoice for account ${account._id.toString()} after ${InvoicesService.CREATE_MAX_RETRIES} retries; last error: ${
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
        account: AccountDocument,
        dto: CreateInvoiceRequest
    ): Promise<InvoiceDocument> {
        const session = await this.connection.startSession();
        try {
            let created: InvoiceDocument | undefined;
            await session.withTransaction(async () => {
                // Sprint 9 §SP-3 — touch-account замість touch-business
                // (symmetric Sprint 4 touch-business pattern). Concurrent
                // `AccountsService.delete` робить `deleteOne({_id: account._id},
                // {session})` у власній TX; Mongo write-write-conflict
                // serialize-ить два TX.
                const touch = await this.accountModel
                    .updateOne(
                        { _id: account._id },
                        { $currentDate: { updatedAt: true } },
                        { session }
                    )
                    .exec();
                if (touch.matchedCount === 0) {
                    // Account cascade-delete виграв race — account більше нема.
                    throw new NotFoundException({
                        code: RESPONSE_CODE.ACCOUNT_NOT_FOUND,
                        message: 'Account deleted during invoice creation',
                    });
                }
                const slugInfo = await this.slugGenerator.generateInvoiceSlug(
                    {
                        businessId: business._id,
                        accountId: account._id,
                        slugInput: dto.slugInput,
                        paymentPurpose: dto.paymentPurpose,
                        businessPaymentPurposeTemplate:
                            business.paymentPurposeTemplate,
                    },
                    session
                );
                // Sprint 9 §SP-6 — `payeeSnapshot.iban` тепер з Account
                // (раніше з `business.requisites.iban`). recipientName/taxId
                // далі з Business (юр-property платника). effectivePurpose
                // resolved через `effectiveInvoicePurpose` як раніше.
                const effectivePurpose = effectiveInvoicePurpose(
                    dto.paymentPurpose,
                    business.paymentPurposeTemplate
                );
                const docs = await this.invoiceModel.create(
                    [
                        {
                            businessId: business._id,
                            accountId: account._id,
                            slug: slugInfo.slug,
                            slugLower: slugInfo.slugLower,
                            amount: dto.amount,
                            amountLocked: dto.amountLocked,
                            paymentPurpose: dto.paymentPurpose,
                            validUntil: dto.validUntil,
                            slugPreset: slugInfo.slugPreset,
                            slugCounterScope: slugInfo.slugCounterScope,
                            slugCounter: slugInfo.slugCounter,
                            payeeSnapshot: {
                                recipientName: business.name,
                                iban: account.iban,
                                taxId: business.taxId,
                                paymentPurpose: effectivePurpose,
                            },
                        },
                    ],
                    { session }
                );
                created = docs[0]!;
            });
            return created!;
        } catch (err) {
            if (isTransactionsUnsupportedError(err)) {
                this.logger.error(
                    `Invoice create failed: replica-set required. Account ${account._id.toString()}. Original: ${
                        err instanceof Error ? err.message : String(err)
                    }`
                );
                throw new InternalServerErrorException({
                    code: RESPONSE_CODE.TRANSACTION_REQUIRES_REPLICA_SET,
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
    async getByAccountId(
        accountId: Types.ObjectId,
        pagination: PaginationParams
    ): Promise<PaginatedInvoices> {
        const { page, limit } = pagination;
        const skip = (page - 1) * limit;
        const [items, total] = await Promise.all([
            this.invoiceModel
                .find({ accountId })
                .sort({ createdAt: -1, _id: -1 })
                .skip(skip)
                .limit(limit)
                .exec(),
            this.invoiceModel.countDocuments({ accountId }),
        ]);
        return { items, total, page, limit };
    }

    /**
     * Sprint 15 — case-insensitive lookup compound `(accountId, slugLower)`.
     * `null` якщо не знайдено — caller (`InvoiceAccessGuard`) обертає у 404.
     * **Cabinet-only** strict (без history-fallback).
     */
    async getBySlug(
        accountId: Types.ObjectId,
        invoiceSlug: string
    ): Promise<InvoiceDocument | null> {
        return this.invoiceModel
            .findOne({ accountId, slugLower: invoiceSlug.toLowerCase() })
            .exec();
    }

    /**
     * Sprint 15 — public lookup з history-fallback (дзеркало Account). Старий
     * invoice-slug у межах TTL резолвиться через `InvoiceSlugHistory` у поточний
     * інвойс; SC робить `permanentRedirect()` на canonical URL.
     */
    async getBySlugOrHistorical(
        accountId: Types.ObjectId,
        invoiceSlug: string
    ): Promise<InvoiceDocument | null> {
        const slugLower = invoiceSlug.toLowerCase();
        const invoice = await this.invoiceModel
            .findOne({ accountId, slugLower })
            .exec();
        if (invoice) return invoice;
        // Sprint 19 — lapse-записи (redirect:false) не редіректять (ім'я на
        // холді). `$ne: false` зберігає поведінку для legacy-записів без поля.
        const historyEntry = await this.historyModel
            .findOne({ accountId, slugLower, redirect: { $ne: false } })
            .lean<{ invoiceId: Types.ObjectId }>()
            .exec();
        if (!historyEntry) return null;
        return this.invoiceModel.findById(historyEntry.invoiceId).exec();
    }

    /**
     * Atomic update + coupled `amount × amountLocked` cross-field check у
     * `$expr`-filter (Sprint 3 §3.2 pattern) + snapshot mirror на PATCH
     * `paymentPurpose` (Sprint 4 review fix).
     *
     * **Coupled-rule:** NOT (next.amount === null AND next.amountLocked === true).
     * De Morgan → next.amount !== null OR next.amountLocked !== true.
     *
     * **Snapshot mirror на `paymentPurpose`-PATCH** (Sprint 4 review re-fix).
     * `payeeSnapshot.paymentPurpose` — single source of truth для public NBU/
     * QR payload (`buildPayloadInputFromInvoice` + `PublicInvoicesController.
     * getPublic`). Якщо PATCH міняє `invoice.paymentPurpose`, але snapshot
     * лишається frozen-from-create — клієнт і банк бачать stale текст, що
     * прямо суперечить контракту "invoice mutable payment data" (див.
     * `public-invoices.controller.ts` doc-block: amount/paymentPurpose/
     * validUntil/lockMask змінні в будь-який момент). Sync контракт:
     * snapshot.paymentPurpose тримає effective-resolved-purpose, що відповідає
     * **поточному** invoice.paymentPurpose. На PATCH: resolve null→
     * business.paymentPurposeTemplate, mirror у snapshot.
     *
     * **Aggregation pipeline update з `$cond`** — single round-trip, що
     * розрізняє snapshot-having (mirror через `$mergeObjects`) і legacy
     * (snapshot=null, лишаємо null; `payload-mapper` fallback-ить на
     * `invoice.paymentPurpose`+template). Без pipeline-update довелось би
     * робити preliminary findOne для snapshot-state-check + умовний $set —
     * додатковий round-trip + race з concurrent PATCH-ом.
     *
     * **`business` параметр (не `businessId`).** Service потребує
     * `business.paymentPurposeTemplate` для null-inheritance-resolution на
     * snapshot mirror. Controller вже має повний `BusinessDocument` через
     * `BusinessAccessGuard`; передавати ще і businessId окремо — duplication.
     */
    async update(
        business: BusinessDocument,
        account: AccountDocument,
        invoice: InvoiceDocument,
        dto: UpdateInvoiceRequest,
        actorLevel: AccessLevel,
        markSlugCustomized = true
    ): Promise<InvoiceDocument> {
        if (dto.validUntil !== undefined) {
            assertValidUntilNotInPast(dto.validUntil);
        }
        const accountId = account._id;
        // Sprint 15 — slug-rename detection by lowercase різниця (case-only
        // зміна оновлює лише display `slug`, history не потрібен).
        const renaming =
            dto.slug !== undefined &&
            dto.slug.toLowerCase() !== invoice.slugLower;
        // Sprint 19 — slug як платна фіча (brand+).
        if (renaming) {
            assertSlugEditAllowed(actorLevel);
        }

        const filter: FilterQuery<InvoiceDocument> = {
            accountId,
            slug: invoice.slug,
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

        // Build pipeline-stage `$set`-ops — explicit per-field, щоб aggregation-
        // pipeline-update (potential strip-у unknown DTO-полів через
        // `.strict()` Zod) мав чітко визначений набір. `paymentPurpose`
        // оброблюється окремо разом з snapshot mirror.
        const setStage: Record<string, unknown> = {};
        if (dto.amount !== undefined) setStage.amount = dto.amount;
        if (dto.amountLocked !== undefined)
            setStage.amountLocked = dto.amountLocked;
        if (dto.validUntil !== undefined) setStage.validUntil = dto.validUntil;
        if (dto.paymentPurpose !== undefined) {
            const resolved = effectiveInvoicePurpose(
                dto.paymentPurpose,
                business.paymentPurposeTemplate
            );
            setStage.paymentPurpose = dto.paymentPurpose;
            // `$cond` гілки:
            //  - snapshot null (legacy без backfill-у) → лишаємо null;
            //    payload-mapper fallback-ить на `invoice.paymentPurpose` +
            //    template (the very fallback path, який буде drop-нуто
            //    у Sprint 6 cleanup після повної міграції).
            //  - snapshot non-null → `$mergeObjects` patch-ить лише поле
            //    paymentPurpose, зберігаючи recipientName/iban/taxId.
            setStage.payeeSnapshot = {
                $cond: [
                    { $eq: ['$payeeSnapshot', null] },
                    '$payeeSnapshot',
                    {
                        $mergeObjects: [
                            '$payeeSnapshot',
                            { paymentPurpose: resolved },
                        ],
                    },
                ],
            };
        }
        // Sprint 15 — slug у setStage. Plain-string literal у aggregation `$set`
        // (не починається з `$` → не field-path). Case-only зміна йде сюди ж
        // (renaming=false); реальний rename — TX-гілка нижче.
        if (dto.slug !== undefined) {
            setStage.slug = dto.slug;
            setStage.slugLower = dto.slug.toLowerCase();
            setStage.slugCustomized = markSlugCustomized;
        }

        if (renaming) {
            return this.renameAndUpdate(
                invoice,
                filter,
                setStage,
                dto.slug!.toLowerCase(),
                hasCoupledFields
            );
        }

        const updated =
            Object.keys(setStage).length > 0
                ? await this.invoiceModel
                      .findOneAndUpdate(filter, [{ $set: setStage }], {
                          new: true,
                      })
                      .exec()
                : await this.invoiceModel
                      .findOne({ accountId, slug: invoice.slug })
                      .exec();
        if (updated) return updated;

        if (hasCoupledFields) {
            const exists = await this.invoiceModel.exists({
                accountId,
                slug: invoice.slug,
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
     * Sprint 15 — slug-rename у TX (дзеркало `BusinessesService` /
     * `AccountsService`). Resolve uniqueness `(accountId, slugLower)`, потім у
     * транзакції: delete self-history (revert), insert старого slug у history,
     * `$set` нового slug + решта setStage (включно з snapshot-mirror $cond).
     * 11000 → `SLUG_TAKEN`.
     */
    private async renameAndUpdate(
        invoice: InvoiceDocument,
        filter: FilterQuery<InvoiceDocument>,
        setStage: Record<string, unknown>,
        newLower: string,
        hasCoupledFields: boolean
    ): Promise<InvoiceDocument> {
        const accountId = invoice.accountId;
        const businessId = invoice.businessId;
        const oldLower = invoice.slugLower;

        await this.assertSlugAvailable(accountId, invoice._id, newLower);

        const session = await this.connection.startSession();
        try {
            let updated: InvoiceDocument | null = null;
            await session.withTransaction(async () => {
                await this.historyModel
                    .deleteMany({ accountId, slugLower: newLower }, { session })
                    .exec();
                await this.historyModel.create(
                    [
                        {
                            businessId,
                            accountId,
                            invoiceId: invoice._id,
                            slugLower: oldLower,
                        },
                    ],
                    { session }
                );
                updated = await this.invoiceModel
                    .findOneAndUpdate(filter, [{ $set: setStage }], {
                        new: true,
                        session,
                    })
                    .exec();
                if (!updated) {
                    // Filter не пропустив update: або coupled-amount violation,
                    // або concurrent delete. Throw abort-ить TX (history rollback).
                    if (hasCoupledFields) {
                        throw new BadRequestException({
                            code: RESPONSE_CODE.INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT,
                            message:
                                'Заблокувати редагування суми можна лише при заданій сумі',
                        });
                    }
                    throw new NotFoundException({
                        code: RESPONSE_CODE.INVOICE_NOT_FOUND,
                        message: 'Invoice disappeared between guard and rename',
                    });
                }
            });
            return updated!;
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                throw new ConflictException({
                    code: RESPONSE_CODE.SLUG_TAKEN,
                    message: 'Invoice slug already taken in this account',
                });
            }
            if (isTransactionsUnsupportedError(err)) {
                this.logger.error(
                    `Invoice slug rename failed: replica-set required. Invoice ${invoice._id.toString()}. Original: ${
                        err instanceof Error ? err.message : String(err)
                    }`
                );
                throw new InternalServerErrorException({
                    code: RESPONSE_CODE.TRANSACTION_REQUIRES_REPLICA_SET,
                    message:
                        'Invoice slug rename requires Mongo replica-set; check MONGODB_URI',
                });
            }
            throw err;
        } finally {
            await session.endSession();
        }
    }

    private async assertSlugAvailable(
        accountId: Types.ObjectId,
        invoiceId: Types.ObjectId,
        newLower: string
    ): Promise<void> {
        const [liveClash, historyClash] = await Promise.all([
            this.invoiceModel.exists({
                accountId,
                slugLower: newLower,
                _id: { $ne: invoiceId },
            }),
            this.historyModel.exists({
                accountId,
                slugLower: newLower,
                invoiceId: { $ne: invoiceId },
            }),
        ]);
        if (liveClash || historyClash) {
            throw new ConflictException({
                code: RESPONSE_CODE.SLUG_TAKEN,
                message: 'Invoice slug already taken in this account',
            });
        }
    }

    /**
     * Скидання slug-у інвойсу за авто-форматом нумерації (дзеркало `create`
     * retry-loop). `mode` — one-time вибір з діалогу перевипуску; відсутність →
     * fallback на `account.invoiceSlugPresetDefault ?? 'simple'` («домашній
     * формат»). Перевипуск дефолт рахунку НЕ змінює (Sprint 17 §billing-design).
     * Counter monotonic: новий slug отримує **наступний** номер scope-у,
     * оригінальний номер не відтворюється (counter permanently consumed).
     *
     * Той самий counter-race захист, що `create`: generate+update у TX; на
     * 11000 — fresh session retry (counter-collision або bootstrap-race).
     */
    async resetSlug(
        business: BusinessDocument,
        account: AccountDocument,
        invoice: InvoiceDocument,
        actorLevel: AccessLevel,
        mode?: AutoSlugMode
    ): Promise<InvoiceDocument> {
        // Sprint 19 — slug як платна фіча (brand+). resetSlug не йде через
        // update(), тож гейт явний тут.
        assertSlugEditAllowed(actorLevel);
        const effectiveMode: AutoSlugMode =
            mode ?? account.invoiceSlugPresetDefault ?? 'simple';
        const slugInput: SlugInput =
            effectiveMode === 'random'
                ? { kind: 'random' }
                : { kind: 'preset', preset: effectiveMode };
        let lastError: unknown;
        for (
            let attempt = 1;
            attempt <= InvoicesService.CREATE_MAX_RETRIES;
            attempt++
        ) {
            try {
                return await this.resetSlugOneAttempt(
                    business,
                    account,
                    invoice,
                    slugInput
                );
            } catch (err) {
                if (isDuplicateKeyError(err)) {
                    lastError = err;
                    this.logger.warn(
                        `Invoice slug reset attempt ${attempt}/${InvoicesService.CREATE_MAX_RETRIES} hit duplicate-key; retrying with fresh session for invoice ${invoice._id.toString()}`
                    );
                    continue;
                }
                throw err;
            }
        }
        this.logger.error(
            `Failed to reset invoice slug for invoice ${invoice._id.toString()} after ${InvoicesService.CREATE_MAX_RETRIES} retries; last error: ${
                lastError instanceof Error
                    ? lastError.message
                    : String(lastError)
            }`
        );
        throw new InternalServerErrorException({
            code: RESPONSE_CODE.INVOICE_SLUG_GENERATION_FAILED,
            message:
                'Failed to reset invoice slug after retries due to slug collision',
        });
    }

    private async resetSlugOneAttempt(
        business: BusinessDocument,
        account: AccountDocument,
        invoice: InvoiceDocument,
        slugInput: SlugInput
    ): Promise<InvoiceDocument> {
        const accountId = account._id;
        const businessId = business._id;
        const oldLower = invoice.slugLower;
        const session = await this.connection.startSession();
        try {
            let updated: InvoiceDocument | null = null;
            await session.withTransaction(async () => {
                // Counter allocation живе у цій самій TX — abort (race/11000)
                // rollback-ить counter разом з rename (без counter-leak).
                const slugInfo = await this.slugGenerator.generateInvoiceSlug(
                    {
                        businessId,
                        accountId,
                        slugInput,
                        paymentPurpose: invoice.paymentPurpose,
                        businessPaymentPurposeTemplate:
                            business.paymentPurposeTemplate,
                    },
                    session
                );
                await this.historyModel
                    .deleteMany(
                        { accountId, slugLower: slugInfo.slugLower },
                        { session }
                    )
                    .exec();
                await this.historyModel.create(
                    [
                        {
                            businessId,
                            accountId,
                            invoiceId: invoice._id,
                            slugLower: oldLower,
                        },
                    ],
                    { session }
                );
                updated = await this.invoiceModel
                    .findOneAndUpdate(
                        { _id: invoice._id },
                        {
                            $set: {
                                slug: slugInfo.slug,
                                slugLower: slugInfo.slugLower,
                                slugPreset: slugInfo.slugPreset,
                                slugCounterScope: slugInfo.slugCounterScope,
                                slugCounter: slugInfo.slugCounter,
                                // Sprint 19 — reset повертає до авто.
                                slugCustomized: false,
                            },
                        },
                        { new: true, runValidators: true, session }
                    )
                    .exec();
                if (!updated) {
                    throw new NotFoundException({
                        code: RESPONSE_CODE.INVOICE_NOT_FOUND,
                        message: 'Invoice disappeared during slug reset',
                    });
                }
            });
            return updated!;
        } catch (err) {
            if (isTransactionsUnsupportedError(err)) {
                this.logger.error(
                    `Invoice slug reset failed: replica-set required. Invoice ${invoice._id.toString()}. Original: ${
                        err instanceof Error ? err.message : String(err)
                    }`
                );
                throw new InternalServerErrorException({
                    code: RESPONSE_CODE.TRANSACTION_REQUIRES_REPLICA_SET,
                    message:
                        'Invoice slug reset requires Mongo replica-set; check MONGODB_URI',
                });
            }
            throw err;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Hard-delete (Sprint 3 рішення C2 — той самий pattern для invoice). 5s
     * frontend-Undo живе на web-стороні як optimistic UI; цей method
     * виконується тільки якщо timer пройшов без cancel-у. Idempotent: повторне
     * delete не падає (race з паралельним delete-ом — тихо OK).
     *
     * **Sprint 15** — у тій самій TX чистимо rename-history інвойсу
     * (`InvoiceSlugHistory.deleteMany({invoiceId})`): видалений інвойс віддає
     * свої посилання одразу, без чекати TTL (дзеркало cascade-семантики).
     */
    async delete(invoice: InvoiceDocument): Promise<void> {
        const invoiceId = invoice._id;
        const session = await this.connection.startSession();
        try {
            let deletedCount = 0;
            await session.withTransaction(async () => {
                const result = await this.invoiceModel
                    .deleteOne({ _id: invoiceId }, { session })
                    .exec();
                deletedCount = result.deletedCount;
                await this.historyModel
                    .deleteMany({ invoiceId }, { session })
                    .exec();
            });
            if (deletedCount === 0) {
                throw new NotFoundException({
                    code: RESPONSE_CODE.INVOICE_NOT_FOUND,
                    message: 'Invoice not found during delete',
                });
            }
            return;
        } catch (err) {
            if (isTransactionsUnsupportedError(err)) {
                this.logger.error(
                    `Invoice delete failed: replica-set required. Invoice ${invoiceId.toString()}. Original: ${
                        err instanceof Error ? err.message : String(err)
                    }`
                );
                throw new InternalServerErrorException({
                    code: RESPONSE_CODE.TRANSACTION_REQUIRES_REPLICA_SET,
                    message:
                        'Invoice delete requires Mongo replica-set; check MONGODB_URI',
                });
            }
            throw err;
        } finally {
            await session.endSession();
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
