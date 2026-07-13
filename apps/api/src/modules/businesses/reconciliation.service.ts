import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { SUBSCRIPTION_STATUS } from '@finly/types';

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
    BillingProfile,
    BillingProfileDocument,
} from '../payments/schemas/billing-profile.schema';
import {
    RECONCILE_LOCK_KEY,
    RECONCILE_LOCK_TTL_MS,
} from '../../common/billing/billing-lock';
import {
    RedisLockBusyError,
    RedisLockService,
} from '../../common/services/redis-lock.service';
import {
    BusinessSlugHistory,
    BusinessSlugHistoryDocument,
} from './schemas/business-slug-history.schema';
import { Business, BusinessDocument } from './schemas/business.schema';
import {
    SlugGeneratorService,
    generateRandomTail,
} from './slug-generator.service';

/**
 * Бюджет slug-rent одного прогону. `remaining` — скільки ще entity-reset-ів
 * дозволено; `incomplete` — лишилась робота поза бюджетом або частина reset-ів
 * упала.
 */
type SlugRentBudget = {
    remaining: number;
    incomplete: boolean;
};

const NESTED_SLUG_MAX_ATTEMPTS = 10;
const SLUG_RENT_MAX_RESETS_PER_RUN = 200;

// Reconcile-мьютекс звільняється швидко (критична секція — Mongo-операції,
// обмежені батч-лімітом вище), тож кілька спроб з коротким бекофом перекривають
// типову контенцію; якщо холдер усе ще тримає лок — повертаємо false, durable
// `reconcileRequiredAt`-стемп caller-а гарантує retry наступним тригером.
const RECONCILE_LOCK_MAX_ATTEMPTS = 5;
const RECONCILE_LOCK_RETRY_DELAY_MS = 200;

/**
 * Sprint 27 — реконсиляція бренд-фіч бізнесу per-business.
 *
 * Модель перевернута з per-user (рівень доступу платника) на per-business
 * (прикріплення бізнесу до активного Бренд-складу). Бізнес «брендований», поки
 * прикріплений хоча б до одного складу платника у статусі ACTIVE або PAST_DUE
 * (грейс). Реконсиляція для набору бізнесів перечитує це наживо і:
 *   - виставляє / знімає денормалізований прапор `brandedAt` (гейтинг і публічний
 *     рендер читають саме його);
 *   - промотує логотип `pending → active` (брендований) або демоутить
 *     `active → pending` (втратив останнє прикріплення), файл лишається;
 *   - при втраті бренду робить slug-rent: скидає кастомні slug-и бізнесу,
 *     реквізитів і рахунків до авто (ім'я повертається ринку), старе → history
 *     з `redirect:false` (резерв на холд без 308).
 *
 * Лімітів кількості бізнесів і рівневої шкали більше немає — блокування бізнесів
 * (`accessBlockedAt`) знято разом з ними.
 *
 * Ідемпотентна: всі оновлення умовні, повторний прогін на незмінному стані —
 * no-op. Викликається BillingProfileService при зміні прикріплень / lapse і
 * daily-sweep для профілів зі стемпом незавершеної реконсиляції.
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
        @InjectModel(BillingProfile.name)
        private readonly profileModel: Model<BillingProfileDocument>,
        @InjectConnection()
        private readonly connection: Connection,
        private readonly slugGenerator: SlugGeneratorService,
        private readonly locks: RedisLockService
    ) {}

    /**
     * Реконсилює бренд-стан набору бізнесів під поточні активні прикріплення.
     * Повертає `true` при ПОВНОМУ проході; `false` — лок зайнятий, slug-rent не
     * вмістився у батч-ліміт або частина reset-ів упала. Caller мусить тримати
     * durable-маркер (`reconcileRequiredAt`) до повного проходу — daily-sweep
     * доганяє.
     *
     * Прохід — під глобальним reconcile-мьютексом (`RECONCILE_LOCK_KEY`):
     * read-then-write на `brandedAt` інакше гонить між тригерами різних
     * платників того самого бізнесу і daily-sweep без user-лока — stale-читання
     * перетирало б свіжий флип без жодного retry-тригера (обидва маркери на той
     * момент уже зняті). Стан читається всередині секції, тож останній reconcile
     * у черзі завжди пише за найсвіжішим станом.
     */
    async reconcileBusinesses(businessIds: string[]): Promise<boolean> {
        const ids = dedupeObjectIds(businessIds);
        if (ids.length === 0) return true;
        for (
            let attempt = 1;
            attempt <= RECONCILE_LOCK_MAX_ATTEMPTS;
            attempt++
        ) {
            try {
                return await this.locks.withLock(
                    RECONCILE_LOCK_KEY,
                    RECONCILE_LOCK_TTL_MS,
                    () => this.reconcileBusinessesLocked(ids)
                );
            } catch (error) {
                if (!(error instanceof RedisLockBusyError)) throw error;
                if (attempt < RECONCILE_LOCK_MAX_ATTEMPTS) {
                    await delay(RECONCILE_LOCK_RETRY_DELAY_MS);
                }
            }
        }
        this.logger.warn(
            `Reconcile lock busy after ${RECONCILE_LOCK_MAX_ATTEMPTS} attempts ` +
                `for ${ids.length} business(es) — deferred to durable marker`
        );
        return false;
    }

    private async reconcileBusinessesLocked(
        ids: Types.ObjectId[]
    ): Promise<boolean> {
        // Які з цих бізнесів прикріплені хоча б до одного активного Бренд-складу.
        const profiles = await this.profileModel
            .find(
                {
                    status: {
                        $in: [
                            SUBSCRIPTION_STATUS.ACTIVE,
                            SUBSCRIPTION_STATUS.PAST_DUE,
                        ],
                    },
                    'brand.attachedBusinessIds': { $in: ids },
                },
                { 'brand.attachedBusinessIds': 1 }
            )
            .lean();

        const brandedSet = new Set<string>();
        for (const p of profiles) {
            for (const bid of p.brand.attachedBusinessIds) {
                brandedSet.add(bid.toString());
            }
        }
        const branded = ids.filter((id) => brandedSet.has(id.toString()));
        const unbranded = ids.filter((id) => !brandedSet.has(id.toString()));

        if (branded.length > 0) {
            await this.businessModel.updateMany(
                { _id: { $in: branded }, brandedAt: null },
                { $set: { brandedAt: new Date() } }
            );
        }
        if (unbranded.length > 0) {
            await this.businessModel.updateMany(
                { _id: { $in: unbranded }, brandedAt: { $ne: null } },
                { $set: { brandedAt: null } }
            );
        }

        await this.reconcileBrandLogos(branded, unbranded);

        // Втратив бренд → скидаємо кастомні slug-и (бізнес + реквізити + рахунки).
        if (unbranded.length > 0) {
            const complete = await this.runSlugRent(unbranded);
            if (!complete) {
                this.logger.warn(
                    `Slug-rent incomplete for ${unbranded.length} business(es) ` +
                        `(batch limit or per-entity failures)`
                );
                return false;
            }
        }
        return true;
    }

    // ── Brand logo promote / demote ─────────────────────────────────────

    private async reconcileBrandLogos(
        branded: Types.ObjectId[],
        unbranded: Types.ObjectId[]
    ): Promise<void> {
        if (branded.length > 0) {
            await this.businessModel.updateMany(
                {
                    _id: { $in: branded },
                    'brand.pending': { $ne: null },
                    'brand.active': null,
                },
                [
                    {
                        $set: {
                            'brand.active': {
                                logoUrl: '$brand.pending.logoUrl',
                                centerMarkUrl: '$brand.pending.centerMarkUrl',
                                bandMarkUrl: '$brand.pending.bandMarkUrl',
                                displayName: '$brand.pending.displayName',
                            },
                            'brand.pending': null,
                        },
                    },
                ]
            );
        }
        if (unbranded.length > 0) {
            await this.businessModel.updateMany(
                { _id: { $in: unbranded }, 'brand.active': { $ne: null } },
                [
                    {
                        $set: {
                            'brand.pending': {
                                logoUrl: '$brand.active.logoUrl',
                                centerMarkUrl: '$brand.active.centerMarkUrl',
                                bandMarkUrl: '$brand.active.bandMarkUrl',
                                displayName: '$brand.active.displayName',
                                uploadedAt: '$$NOW',
                                demoted: true,
                            },
                            'brand.active': null,
                        },
                    },
                ]
            );
        }
    }

    // ── Slug-rent reset (business lost brand) ────────────────────────────

    private async runSlugRent(businessIds: Types.ObjectId[]): Promise<boolean> {
        const budget: SlugRentBudget = {
            remaining: SLUG_RENT_MAX_RESETS_PER_RUN,
            incomplete: false,
        };
        await this.resetCustomizedBusinessSlugs(businessIds, budget);
        await this.resetCustomizedAccountSlugs(businessIds, budget);
        await this.resetCustomizedInvoiceSlugs(businessIds, budget);
        return !budget.incomplete;
    }

    private async resetCustomizedBusinessSlugs(
        businessIds: Types.ObjectId[],
        budget: SlugRentBudget
    ): Promise<void> {
        if (budget.remaining <= 0) {
            budget.incomplete = true;
            return;
        }
        const customized = await this.businessModel
            .find(
                { _id: { $in: businessIds }, slugCustomized: true },
                { slugLower: 1 }
            )
            .limit(budget.remaining + 1)
            .lean<Array<{ _id: Types.ObjectId; slugLower: string }>>()
            .exec();
        if (customized.length > budget.remaining) {
            budget.incomplete = true;
            customized.length = budget.remaining;
        }
        for (const biz of customized) {
            const ok = await this.safeReset('business', biz._id, () =>
                this.resetOneBusinessSlug(biz._id, biz.slugLower)
            );
            if (!ok) budget.incomplete = true;
            budget.remaining--;
        }
    }

    private async resetCustomizedAccountSlugs(
        businessIds: Types.ObjectId[],
        budget: SlugRentBudget
    ): Promise<void> {
        if (budget.remaining <= 0) {
            budget.incomplete = true;
            return;
        }
        const customized = await this.accountModel
            .find(
                { businessId: { $in: businessIds }, slugCustomized: true },
                { businessId: 1, slugLower: 1 }
            )
            .limit(budget.remaining + 1)
            .lean<
                Array<{
                    _id: Types.ObjectId;
                    businessId: Types.ObjectId;
                    slugLower: string;
                }>
            >()
            .exec();
        if (customized.length > budget.remaining) {
            budget.incomplete = true;
            customized.length = budget.remaining;
        }
        for (const acc of customized) {
            const ok = await this.safeReset('account', acc._id, () =>
                this.resetOneAccountSlug(acc._id, acc.businessId, acc.slugLower)
            );
            if (!ok) budget.incomplete = true;
            budget.remaining--;
        }
    }

    private async resetCustomizedInvoiceSlugs(
        businessIds: Types.ObjectId[],
        budget: SlugRentBudget
    ): Promise<void> {
        if (budget.remaining <= 0) {
            budget.incomplete = true;
            return;
        }
        const customized = await this.invoiceModel
            .find(
                { businessId: { $in: businessIds }, slugCustomized: true },
                { businessId: 1, accountId: 1, slugLower: 1 }
            )
            .limit(budget.remaining + 1)
            .lean<
                Array<{
                    _id: Types.ObjectId;
                    businessId: Types.ObjectId;
                    accountId: Types.ObjectId;
                    slugLower: string;
                }>
            >()
            .exec();
        if (customized.length > budget.remaining) {
            budget.incomplete = true;
            customized.length = budget.remaining;
        }
        for (const inv of customized) {
            const ok = await this.safeReset('invoice', inv._id, () =>
                this.resetOneInvoiceSlug(
                    inv._id,
                    inv.businessId,
                    inv.accountId,
                    inv.slugLower
                )
            );
            if (!ok) budget.incomplete = true;
            budget.remaining--;
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
            const updated = await this.businessModel.updateOne(
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
            if (updated.matchedCount === 0) {
                throw new Error(
                    `Business ${businessId.toString()} vanished during slug reset`
                );
            }
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
            const updated = await this.accountModel.updateOne(
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
            if (updated.matchedCount === 0) {
                throw new Error(
                    `Account ${accountId.toString()} vanished during slug reset`
                );
            }
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
            const updated = await this.invoiceModel.updateOne(
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
            if (updated.matchedCount === 0) {
                throw new Error(
                    `Invoice ${invoiceId.toString()} vanished during slug reset`
                );
            }
        });
    }

    private async safeReset(
        kind: string,
        id: Types.ObjectId,
        fn: () => Promise<void>
    ): Promise<boolean> {
        try {
            await fn();
            return true;
        } catch (error) {
            this.logger.error(
                `Failed to reset ${kind} slug ${id.toString()} ` +
                    `(deferred to next trigger)`,
                error instanceof Error ? error.stack : String(error)
            );
            return false;
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

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function dedupeObjectIds(ids: string[]): Types.ObjectId[] {
    const seen = new Set<string>();
    const out: Types.ObjectId[] = [];
    for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(new Types.ObjectId(id));
    }
    return out;
}
