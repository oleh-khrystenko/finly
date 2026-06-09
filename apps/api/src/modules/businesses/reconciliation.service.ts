import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
    isAccessLevelAtLeast,
    type AccessLevel,
    type BusinessType,
} from '@finly/types';

import { resolveAccessLevel } from '../../common/billing/resolve-access-level';
import { UsersService } from '../users/users.service';
import {
    AccountSlugHistory,
    AccountSlugHistoryDocument,
} from '../accounts/schemas/account-slug-history.schema';
import { Account, AccountDocument } from '../accounts/schemas/account.schema';
import {
    InvoiceSlugHistory,
    InvoiceSlugHistoryDocument,
} from '../invoices/schemas/invoice-slug-history.schema';
import { Invoice, InvoiceDocument } from '../invoices/schemas/invoice.schema';
import {
    BusinessSlugHistory,
    BusinessSlugHistoryDocument,
} from './schemas/business-slug-history.schema';
import { Business, BusinessDocument } from './schemas/business.schema';
import {
    SlugGeneratorService,
    generateRandomTail,
} from './slug-generator.service';

type BucketItem = {
    _id: Types.ObjectId;
    accessBlockedAt: Date | null;
};

const NESTED_SLUG_MAX_ATTEMPTS = 10;

/**
 * Sprint 19 — реконсиляція бізнесів під поточний рівень доступу користувача.
 *
 * Ідемпотентна і двонаправлена: викликається при будь-якій зміні білінг-стану
 * (втрата доступу — скасування підписки, сплив past-due/one-off; повернення —
 * нова підписка/one-off). Перераховує, які бізнеси виживають у межах лімітів
 * рівня, блокує зайві (стемп `accessBlockedAt`) і знімає блокування з тих, що
 * знову в межах. Нічого не видаляє — заблокований бізнес лишається у кабінеті,
 * користувач може лише видалити вручну.
 *
 * Правило виживання — «найстаріші per-bucket»: у кожному відрі (власні per-тип,
 * клієнтські) виживають найперше створені в межах ліміту, решта блокуються.
 * Фізособа/ФОП завжди ≤1 (доменний інваріант), тож ніколи не блокуються.
 *
 * Slug-rent: при падінні нижче brand усі кастомні (vanity) slug-и користувача —
 * бізнесів, реквізитів (account) і рахунків (invoice) — скидаються до авто,
 * старе ім'я їде у відповідну `*SlugHistory` з `redirect:false` (резерв на холд
 * без 308). Account/invoice slug генеруємо inline через `generateRandomTail` +
 * scope-uniqueness, тож downstream-генератор-сервіси (DAG `Businesses ←
 * Accounts ← Invoices`) не потрібні — лише їх моделі (вже у forFeature).
 */
@Injectable()
export class ReconciliationService {
    private readonly logger = new Logger(ReconciliationService.name);

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
        @InjectConnection()
        private readonly connection: Connection,
        private readonly slugGenerator: SlugGeneratorService,
        private readonly usersService: UsersService
    ) {}

    async reconcile(userId: string): Promise<void> {
        const user = await this.usersService.findById(userId);
        if (!user) return;
        const level = resolveAccessLevel(user.billing);
        const userObjectId = new Types.ObjectId(userId);

        const owned = await this.businessModel
            .find(
                { ownerId: userObjectId },
                { type: 1, accessBlockedAt: 1, createdAt: 1 }
            )
            .sort({ createdAt: 1 })
            .lean<Array<BucketItem & { type: BusinessType }>>()
            .exec();
        const client = await this.businessModel
            .find(
                { ownerId: null, managers: userObjectId },
                { accessBlockedAt: 1, createdAt: 1 }
            )
            .sort({ createdAt: 1 })
            .lean<BucketItem[]>()
            .exec();

        const toBlock: Types.ObjectId[] = [];
        const toUnblock: Types.ObjectId[] = [];

        const ownedByType = new Map<BusinessType, BucketItem[]>();
        for (const b of owned) {
            const list = ownedByType.get(b.type) ?? [];
            list.push(b);
            ownedByType.set(b.type, list);
        }
        for (const [type, list] of ownedByType) {
            partitionBucket(list, ownedLimit(type, level), toBlock, toUnblock);
        }
        partitionBucket(client, clientLimit(level), toBlock, toUnblock);

        if (toBlock.length > 0) {
            await this.businessModel.updateMany(
                { _id: { $in: toBlock }, accessBlockedAt: null },
                { $set: { accessBlockedAt: new Date() } }
            );
        }
        if (toUnblock.length > 0) {
            await this.businessModel.updateMany(
                { _id: { $in: toUnblock }, accessBlockedAt: { $ne: null } },
                { $set: { accessBlockedAt: null } }
            );
        }

        if (toBlock.length > 0 || toUnblock.length > 0) {
            this.logger.log(
                `Reconciled user ${userId} (level ${level}): ` +
                    `${toBlock.length} to block, ${toUnblock.length} to unblock`
            );
        }

        // Slug-rent: нижче brand втрачається право на vanity-slug → скидаємо
        // кастомні slug-и бізнесів, реквізитів і рахунків до авто (ім'я
        // повертається ринку). brand/bookkeeper зберігають кастомні.
        // Ідемпотентно: після reset slugCustomized=false, повторний прогін не
        // чіпає. businessIds беремо з уже завантажених bucket-ів (без зайвого
        // запиту).
        if (!isAccessLevelAtLeast(level, 'brand')) {
            const businessIds = [...owned, ...client].map((b) => b._id);
            if (businessIds.length > 0) {
                await this.resetCustomizedBusinessSlugs(businessIds);
                await this.resetCustomizedAccountSlugs(businessIds);
                await this.resetCustomizedInvoiceSlugs(businessIds);
            }
        }
    }

    // ── Slug-rent reset (рівень нижче brand) ─────────────────────────────

    private async resetCustomizedBusinessSlugs(
        businessIds: Types.ObjectId[]
    ): Promise<void> {
        const customized = await this.businessModel
            .find(
                { _id: { $in: businessIds }, slugCustomized: true },
                { slugLower: 1 }
            )
            .lean<Array<{ _id: Types.ObjectId; slugLower: string }>>()
            .exec();

        for (const biz of customized) {
            await this.safeReset('business', biz._id, () =>
                this.resetOneBusinessSlug(biz._id, biz.slugLower)
            );
        }
    }

    private async resetCustomizedAccountSlugs(
        businessIds: Types.ObjectId[]
    ): Promise<void> {
        const customized = await this.accountModel
            .find(
                { businessId: { $in: businessIds }, slugCustomized: true },
                { businessId: 1, slugLower: 1 }
            )
            .lean<
                Array<{
                    _id: Types.ObjectId;
                    businessId: Types.ObjectId;
                    slugLower: string;
                }>
            >()
            .exec();

        for (const acc of customized) {
            await this.safeReset('account', acc._id, () =>
                this.resetOneAccountSlug(acc._id, acc.businessId, acc.slugLower)
            );
        }
    }

    private async resetCustomizedInvoiceSlugs(
        businessIds: Types.ObjectId[]
    ): Promise<void> {
        const customized = await this.invoiceModel
            .find(
                { businessId: { $in: businessIds }, slugCustomized: true },
                { businessId: 1, accountId: 1, slugLower: 1 }
            )
            .lean<
                Array<{
                    _id: Types.ObjectId;
                    businessId: Types.ObjectId;
                    accountId: Types.ObjectId;
                    slugLower: string;
                }>
            >()
            .exec();

        for (const inv of customized) {
            await this.safeReset('invoice', inv._id, () =>
                this.resetOneInvoiceSlug(
                    inv._id,
                    inv.businessId,
                    inv.accountId,
                    inv.slugLower
                )
            );
        }
    }

    private async resetOneBusinessSlug(
        businessId: Types.ObjectId,
        oldLower: string
    ): Promise<void> {
        const newSlug = await this.slugGenerator.generateRandomSlug();
        const newLower = newSlug.toLowerCase();
        await this.inTransaction(async (session) => {
            await this.historyModel
                .deleteMany({ businessId, slugLower: newLower }, { session })
                .exec();
            await this.historyModel.create(
                [{ businessId, slugLower: oldLower, redirect: false }],
                { session }
            );
            await this.businessModel.updateOne(
                { _id: businessId },
                {
                    $set: {
                        slug: newSlug,
                        slugLower: newLower,
                        slugCustomized: false,
                    },
                },
                { session }
            );
        });
    }

    private async resetOneAccountSlug(
        accountId: Types.ObjectId,
        businessId: Types.ObjectId,
        oldLower: string
    ): Promise<void> {
        const tail = await this.generateUniqueTail(async (lower) => {
            const [acc, hist] = await Promise.all([
                this.accountModel.exists({ businessId, slugLower: lower }),
                this.accountHistoryModel.exists({
                    businessId,
                    slugLower: lower,
                }),
            ]);
            return acc != null || hist != null;
        });
        const newLower = tail.toLowerCase();
        await this.inTransaction(async (session) => {
            await this.accountHistoryModel
                .deleteMany({ businessId, slugLower: newLower }, { session })
                .exec();
            await this.accountHistoryModel.create(
                [
                    {
                        businessId,
                        accountId,
                        slugLower: oldLower,
                        redirect: false,
                    },
                ],
                { session }
            );
            await this.accountModel.updateOne(
                { _id: accountId },
                {
                    $set: {
                        slug: tail,
                        slugLower: newLower,
                        slugCustomized: false,
                    },
                },
                { session }
            );
        });
    }

    private async resetOneInvoiceSlug(
        invoiceId: Types.ObjectId,
        businessId: Types.ObjectId,
        accountId: Types.ObjectId,
        oldLower: string
    ): Promise<void> {
        const tail = await this.generateUniqueTail(async (lower) => {
            const [inv, hist] = await Promise.all([
                this.invoiceModel.exists({ accountId, slugLower: lower }),
                this.invoiceHistoryModel.exists({
                    accountId,
                    slugLower: lower,
                }),
            ]);
            return inv != null || hist != null;
        });
        const newLower = tail.toLowerCase();
        await this.inTransaction(async (session) => {
            await this.invoiceHistoryModel
                .deleteMany({ accountId, slugLower: newLower }, { session })
                .exec();
            await this.invoiceHistoryModel.create(
                [
                    {
                        businessId,
                        accountId,
                        invoiceId,
                        slugLower: oldLower,
                        redirect: false,
                    },
                ],
                { session }
            );
            // Reset до random-slug-у без counter-нумерації: slugPreset/scope/
            // counter обнуляються (інвойс більше не counter-based), інакше stale
            // counter висів би у partial-unique-індексі.
            await this.invoiceModel.updateOne(
                { _id: invoiceId },
                {
                    $set: {
                        slug: tail,
                        slugLower: newLower,
                        slugCustomized: false,
                        slugPreset: null,
                        slugCounterScope: null,
                        slugCounter: null,
                    },
                },
                { session }
            );
        });
    }

    /**
     * Best-effort обгортка для per-entity slug-reset: збій одного не зриває
     * решту батча (наступний reconcile-тригер доскидає — slugCustomized
     * лишається true).
     */
    private async safeReset(
        kind: string,
        id: Types.ObjectId,
        fn: () => Promise<void>
    ): Promise<void> {
        try {
            await fn();
        } catch (error) {
            this.logger.error(
                `Failed to reset ${kind} slug ${id.toString()} ` +
                    `(deferred to next trigger)`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    private async inTransaction(
        fn: (session: ClientSession) => Promise<void>
    ): Promise<void> {
        const session = await this.connection.startSession();
        try {
            await session.withTransaction(() => fn(session));
        } finally {
            await session.endSession();
        }
    }

    private async generateUniqueTail(
        isTaken: (lower: string) => Promise<boolean>
    ): Promise<string> {
        for (let attempt = 0; attempt < NESTED_SLUG_MAX_ATTEMPTS; attempt++) {
            const tail = generateRandomTail();
            if (!(await isTaken(tail.toLowerCase()))) return tail;
        }
        throw new Error(
            `Failed to generate unique nested slug after ${NESTED_SLUG_MAX_ATTEMPTS} attempts`
        );
    }
}

// ── Module-level pure helpers ────────────────────────────────────────────

/** Ліміт власних бізнесів за типом і рівнем доступу. */
function ownedLimit(type: BusinessType, level: AccessLevel): number {
    // Фізособа / ФОП — доменний інваріант ≤1 на будь-якому рівні (їх і так
    // максимум 1 через create-замок, тож вони завжди виживають).
    if (type === 'individual' || type === 'fop') return 1;
    // ТОВ / організація — 1 на none/brand, без ліміту на bookkeeper.
    return isAccessLevelAtLeast(level, 'bookkeeper')
        ? Number.POSITIVE_INFINITY
        : 1;
}

/** Ліміт клієнтських бізнесів за рівнем доступу. */
function clientLimit(level: AccessLevel): number {
    return isAccessLevelAtLeast(level, 'bookkeeper')
        ? Number.POSITIVE_INFINITY
        : 10;
}

/**
 * Перші `limit` (за createdAt asc) виживають → знімаємо блокування; решта →
 * блокуємо. Колекціонує id у спільні toBlock/toUnblock; самі updateMany з
 * conditional-фільтром роблять операцію ідемпотентною.
 */
function partitionBucket(
    sortedOldestFirst: BucketItem[],
    limit: number,
    toBlock: Types.ObjectId[],
    toUnblock: Types.ObjectId[]
): void {
    sortedOldestFirst.forEach((item, index) => {
        if (index < limit) {
            toUnblock.push(item._id);
        } else {
            toBlock.push(item._id);
        }
    });
}
