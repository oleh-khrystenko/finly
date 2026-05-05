import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type FilterQuery } from 'mongoose';
import {
    RESPONSE_CODE,
    type CreateInvoiceRequest,
    type UpdateInvoiceRequest,
} from '@finly/types';

import type { BusinessDocument } from '../businesses/schemas/business.schema';
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
        private readonly slugGenerator: InvoiceSlugGeneratorService
    ) {}

    async create(
        business: BusinessDocument,
        dto: CreateInvoiceRequest
    ): Promise<InvoiceDocument> {
        // Race-protected loop (SP-1 risk #2). Generator робить optimistic
        // counter read; insert або проходить, або падає на partial-unique
        // compound (Sprint 4 §4.1). Retry читає вже persistований counter
        // і повертає N+1.
        let lastError: unknown;
        for (
            let attempt = 1;
            attempt <= InvoicesService.CREATE_MAX_RETRIES;
            attempt++
        ) {
            const slugInfo = await this.slugGenerator.generateInvoiceSlug({
                businessId: business._id,
                slugInput: dto.slugInput,
                paymentPurpose: dto.paymentPurpose,
                businessPaymentPurposeTemplate: business.paymentPurposeTemplate,
            });
            try {
                return await this.invoiceModel.create({
                    businessId: business._id,
                    slug: slugInfo.slug,
                    amount: dto.amount,
                    amountLocked: dto.amountLocked,
                    paymentPurpose: dto.paymentPurpose,
                    validUntil: dto.validUntil,
                    slugPreset: slugInfo.slugPreset,
                    slugCounterScope: slugInfo.slugCounterScope,
                    slugCounter: slugInfo.slugCounter,
                });
            } catch (err) {
                if (isDuplicateKeyError(err)) {
                    lastError = err;
                    this.logger.warn(
                        `Invoice insert attempt ${attempt}/${InvoicesService.CREATE_MAX_RETRIES} hit duplicate-key; retrying generation for business ${business._id.toString()}`
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
     * Paginated list для cabinet секції "Рахунки" (§4.4). Sort `createdAt
     * desc` — найновіші зверху, як у списку бізнесів Sprint 3.
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
                .sort({ createdAt: -1 })
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
