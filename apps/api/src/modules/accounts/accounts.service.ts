import {
    ConflictException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import {
    BANK_LABEL,
    RESPONSE_CODE,
    bankCodeFromIban,
    type AccountWithCounts,
    type CreateAccountRequest,
    type UpdateAccountRequest,
} from '@finly/types';

import { pluralizeUa } from '../../common/intl/pluralize-ua';
import { isTransactionsUnsupportedError } from '../../common/mongoose/transactions-unsupported';
import {
    Business,
    type BusinessDocument,
} from '../businesses/schemas/business.schema';
import { InvoiceSlugCounter } from '../invoices/schemas/invoice-slug-counter.schema';
import { Invoice } from '../invoices/schemas/invoice.schema';
import { AccountSlugGeneratorService } from './account-slug-generator.service';
import { Account, AccountDocument } from './schemas/account.schema';

/**
 * Sprint 9 §9.1 — primary CRUD service для Account.
 *
 * **Create** — `bankCode` stored derived з `bankCodeFromIban(iban)` рівно
 * один раз (§SP-9). Auto-name `"{BANK_LABEL[bankCode]} •{last4}"` або
 * `"Банк •{last4}"` на null-bankCode, якщо клієнт не передав. На 11000 →
 * розгалуження: collision на `(businessId, slug)` → `ACCOUNT_SLUG_GENERATION_FAILED`,
 * collision на `(businessId, iban)` → `ACCOUNT_IBAN_DUPLICATE`, інакше →
 * safety-net `ACCOUNT_CREATE_FAILED`.
 *
 * **Delete** (§SP-3 race-protection) — атомарно у `session.withTransaction`:
 *  - `Invoice.countDocuments({accountId}, { session })` → `> 0 → 409
 *    ACCOUNT_HAS_INVOICES` (abort tx; повідомлення pre-resolved через
 *    `pluralizeUa`).
 *  - інакше: `Account.deleteOne` + `InvoiceSlugCounter.deleteMany({accountId})`.
 *
 * Race з concurrent `InvoicesService.create` (touch-account у власній tx,
 * symmetric до Sprint 4 touch-business pattern) серіалізується Mongo write-
 * write conflict-detection-ом.
 */
@Injectable()
export class AccountsService {
    private readonly logger = new Logger(AccountsService.name);

    constructor(
        @InjectModel(Account.name)
        private readonly accountModel: Model<AccountDocument>,
        @InjectModel(Business.name)
        private readonly businessModel: Model<BusinessDocument>,
        @InjectModel(Invoice.name)
        private readonly invoiceModel: Model<{ accountId: Types.ObjectId }>,
        @InjectModel(InvoiceSlugCounter.name)
        private readonly counterModel: Model<{ accountId: Types.ObjectId }>,
        @InjectConnection()
        private readonly connection: Connection,
        private readonly slugGenerator: AccountSlugGeneratorService
    ) {}

    /**
     * Sprint 9 §SP-1 — create account з orphan-prevention vs concurrent
     * cascade-delete business (symmetric Sprint 4 review fix для Invoice→
     * Business, перенесений рівнем вище: Account→Business).
     *
     * **Race-сценарій без транзакції:** `BusinessesService.delete` у власній
     * tx виконує `accountModel.deleteMany({businessId}, {session})` →
     * snapshot не бачить нового account-а; `AccountsService.create` встигає
     * insert-нути account після cascade-deleteMany, але до commit-у
     * `businessModel.deleteOne` — Mongo комітить delete + orphan-Account
     * лишається з `businessId` на видалений Business.
     *
     * **Фікс:** create живе всередині `withTransaction`. Перший крок —
     * touch-business (`updateOne $currentDate: { updatedAt: true }`) у тій
     * самій сесії: створює write-intent на business document; concurrent
     * `BusinessesService.delete.deleteOne({_id: business._id}, {session})`
     * на тому самому _id тригерить write-conflict (Mongo abort-ить одну з
     * TX, withTransaction робить retry автоматично через
     * TransientTransactionError-label).
     *
     * **Cascade виграв race** (`matchedCount === 0`) → business вже немає →
     * 404 `BUSINESS_NOT_FOUND`; insert не виконується, orphan-state неможливий.
     */
    async create(
        business: BusinessDocument,
        dto: CreateAccountRequest
    ): Promise<AccountDocument> {
        const bankCode = bankCodeFromIban(dto.iban);
        const last4 = dto.iban.slice(-4);
        const defaultName =
            bankCode === null
                ? `Банк •${last4}`
                : `${BANK_LABEL[bankCode]} •${last4}`;
        const slug = await this.slugGenerator.generateUnique(business._id);
        const session = await this.connection.startSession();
        try {
            let created: AccountDocument | undefined;
            await session.withTransaction(async () => {
                const touch = await this.businessModel
                    .updateOne(
                        { _id: business._id },
                        { $currentDate: { updatedAt: true } },
                        { session }
                    )
                    .exec();
                if (touch.matchedCount === 0) {
                    throw new NotFoundException({
                        code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
                        message: 'Business deleted during account creation',
                    });
                }
                const docs = await this.accountModel.create(
                    [
                        {
                            businessId: business._id,
                            iban: dto.iban,
                            bankCode,
                            name: dto.name ?? defaultName,
                            slug,
                        },
                    ],
                    { session }
                );
                created = docs[0]!;
            });
            return created!;
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                const keyPattern = readKeyPattern(err);
                if (keyPattern.iban === 1) {
                    throw new ConflictException({
                        code: RESPONSE_CODE.ACCOUNT_IBAN_DUPLICATE,
                        message: 'IBAN already used for this business',
                    });
                }
                if (keyPattern.slug === 1) {
                    this.logger.error(
                        `Slug collision race for business ${business._id.toString()} slug "${slug}"`
                    );
                    throw new InternalServerErrorException({
                        code: RESPONSE_CODE.ACCOUNT_SLUG_GENERATION_FAILED,
                        message: 'Account slug collision; please retry',
                    });
                }
                this.logger.error(
                    `Unexpected 11000 keyPattern for AccountsService.create: ${JSON.stringify(keyPattern)}`
                );
                throw new InternalServerErrorException({
                    code: RESPONSE_CODE.ACCOUNT_CREATE_FAILED,
                    message: 'Failed to create account',
                });
            }
            if (isTransactionsUnsupportedError(err)) {
                this.logger.error(
                    `Account create failed: replica-set required. Business ${business._id.toString()}. Original: ${
                        err instanceof Error ? err.message : String(err)
                    }`
                );
                throw new InternalServerErrorException({
                    code: RESPONSE_CODE.TRANSACTION_REQUIRES_REPLICA_SET,
                    message:
                        'Account create requires Mongo replica-set; check MONGODB_URI',
                });
            }
            throw err;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Public-list flow (`pay.finly.com.ua/{businessSlug}` root + `accounts`-array
     * у `PublicBusinessSchema`). Повертає Mongoose-документи — caller-и читають
     * `account.iban`, `.slug`, `.name`, `.bankCode` typed через `AccountDocument`
     * (без `Record<string, unknown>`-cast-у).
     *
     * **Sort `{ createdAt: 1 }` (asc)** — customer-perspective "перший-створений
     * = основний-рахунок зверху" (§9.1). Index `(businessId, createdAt)`
     * direction-neutral.
     */
    async listForBusinessPublic(
        businessId: Types.ObjectId
    ): Promise<AccountDocument[]> {
        return this.accountModel
            .find({ businessId })
            .sort({ createdAt: 1 })
            .exec();
    }

    /**
     * Cabinet-list flow з per-item `invoicesCount` через single aggregation
     * pipeline (`$lookup` + nested `$count`). Один Mongo round-trip незалежно
     * від кількості account-ів.
     *
     * **Sort `{ createdAt: -1 }` (desc)** — cabinet UI "найновіші зверху".
     */
    async listForBusinessWithCounts(
        businessId: Types.ObjectId
    ): Promise<AccountWithCounts[]> {
        const result = await this.accountModel
            .aggregate([
                { $match: { businessId } },
                { $sort: { createdAt: -1 } },
                {
                    $lookup: {
                        from: 'invoices',
                        let: { aid: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: { $eq: ['$accountId', '$$aid'] },
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
                        id: { $toString: '$_id' },
                        invoiceSlugPresetDefault: {
                            $ifNull: ['$invoiceSlugPresetDefault', null],
                        },
                        bankCode: { $ifNull: ['$bankCode', null] },
                    },
                },
                { $unset: ['__invoicesCount', '_id', '__v'] },
            ])
            .exec();
        return result as AccountWithCounts[];
    }

    /**
     * Case-sensitive lookup compound `(businessId, slug)`. Повертає `null`
     * якщо не знайдено — caller (`AccountAccessGuard`) обертає у 404.
     */
    async getBySlug(
        businessId: Types.ObjectId,
        accountSlug: string
    ): Promise<AccountDocument | null> {
        return this.accountModel
            .findOne({ businessId, slug: accountSlug })
            .exec();
    }

    async countInvoices(accountId: Types.ObjectId): Promise<number> {
        return this.invoiceModel.countDocuments({ accountId });
    }

    async countByBusinessId(businessId: Types.ObjectId): Promise<number> {
        return this.accountModel.countDocuments({ businessId });
    }

    /**
     * Sprint 10 review fix — lookup для POST2-replay у `LandingClaimService`.
     * Single-document read через `(businessId, iban)` compound-unique-index
     * (Sprint 9 §SP-2) — O(1) на DB-рівні. Не використовується cabinet-flow-ом
     * (там IBAN не lookup-key, бо unique тільки у scope-і business-у); живе тут
     * як domain-owned read-helper, не у LandingClaimService напряму
     * (LandingClaim не має @InjectModel-доступу до Account і не повинен мати —
     * separation-of-concerns).
     */
    async findByBusinessAndIban(
        businessId: Types.ObjectId,
        iban: string
    ): Promise<AccountDocument | null> {
        return this.accountModel.findOne({ businessId, iban }).exec();
    }

    async update(
        account: AccountDocument,
        dto: UpdateAccountRequest
    ): Promise<AccountDocument> {
        if (Object.keys(dto).length === 0) {
            return account;
        }
        const updated = await this.accountModel
            .findOneAndUpdate(
                { _id: account._id },
                { $set: dto },
                { new: true, runValidators: true }
            )
            .exec();
        if (!updated) {
            // Race з паралельним delete-ом — account зник між guard і update.
            // 404 (не 400) — той самий HTTP-семантичний контракт, що
            // `AccountAccessGuard` для guard-miss; frontend `mapApiCode`
            // розрізняє "сутність зникла" vs "валідаційна помилка".
            throw new NotFoundException({
                code: RESPONSE_CODE.ACCOUNT_NOT_FOUND,
                message: 'Account disappeared between guard and update',
            });
        }
        return updated;
    }

    /**
     * §SP-3 — атомарно у `session.withTransaction`:
     *  1. `Invoice.countDocuments({accountId}, { session })` → > 0 throw
     *     409 `ACCOUNT_HAS_INVOICES` (abort tx);
     *  2. `Account.deleteOne` + `InvoiceSlugCounter.deleteMany({accountId})`.
     *
     * Concurrent `InvoicesService.create` (touch-account у власній tx,
     * symmetric Sprint 4 touch-business) → Mongo write-write conflict
     * serialize-ить два TX: або create-touch виграє і delete-tx retry-неться
     * (увидить count=1 і кине 409), або delete-tx виграє і create-tx
     * matchedCount=0 → 404.
     *
     * Replica-set requirement — без змін від Sprint 4. На standalone Mongo
     * → 500 `TRANSACTION_REQUIRES_REPLICA_SET`.
     */
    async delete(account: AccountDocument): Promise<void> {
        const accountId = account._id;
        const session = await this.connection.startSession();
        try {
            await session.withTransaction(async () => {
                const count = await this.invoiceModel.countDocuments(
                    { accountId },
                    { session }
                );
                if (count > 0) {
                    const invoicesPhrase = pluralizeUa(
                        count,
                        'виставлений інвойс',
                        'виставлені інвойси',
                        'виставлених інвойсів'
                    );
                    throw new ConflictException({
                        code: RESPONSE_CODE.ACCOUNT_HAS_INVOICES,
                        message: `Цей рахунок має ${invoicesPhrase}. Спочатку видаліть їх або весь бізнес`,
                    });
                }
                await this.counterModel.deleteMany({ accountId }, { session });
                await this.accountModel.deleteOne(
                    { _id: accountId },
                    { session }
                );
            });
        } catch (err) {
            if (isTransactionsUnsupportedError(err)) {
                this.logger.error(
                    `Account delete failed: replica-set required. Account ${accountId.toString()}. Original: ${
                        err instanceof Error ? err.message : String(err)
                    }`
                );
                throw new InternalServerErrorException({
                    code: RESPONSE_CODE.TRANSACTION_REQUIRES_REPLICA_SET,
                    message:
                        'Account delete requires Mongo replica-set; check MONGODB_URI',
                });
            }
            throw err;
        } finally {
            await session.endSession();
        }
    }
}

function isDuplicateKeyError(err: unknown): boolean {
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
