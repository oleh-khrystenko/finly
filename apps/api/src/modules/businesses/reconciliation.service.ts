import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
    isAccessLevelAtLeast,
    type AccessLevel,
    type BusinessType,
} from '@finly/types';

import {
    BILLING_LOCK_TTL_MS,
    billingLockKey,
} from '../../common/billing/billing-lock';
import { isAwaitingDeferredFirstCharge } from '../../common/billing/deferred-start';
import { resolveAccessLevel } from '../../common/billing/resolve-access-level';
import {
    RedisLockBusyError,
    RedisLockService,
} from '../../common/services/redis-lock.service';
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

/**
 * Бюджет slug-rent одного прогону. `remaining` — скільки ще entity-reset-ів
 * дозволено; `incomplete` — лишилась робота поза бюджетом або частина reset-ів
 * упала (обидва випадки → durable-стемп `reconcileRequiredAt`, доганяє
 * daily-sweep).
 */
type SlugRentBudget = {
    remaining: number;
    incomplete: boolean;
};

const NESTED_SLUG_MAX_ATTEMPTS = 10;

// Стеля per-entity slug-reset-ів за один прогін реконсиляції. Реконсиляція
// виконується під білінг-локом (TTL — див. billing-lock.ts), а кількість
// кастомних slug-ів bookkeeper-користувача необмежена за продуктом — без
// батч-ліміту довгий slug-rent виїв би TTL (зник би mutual-exclusion) і
// затягував би webhook-відповідь провайдеру. Кожен reset — коротка TX
// (одиниці-десятки мс), тож 200 тримає прогін у межах кількох секунд;
// решта доганяється наступними прогонами через `reconcileRequiredAt`-стемп.
const SLUG_RENT_MAX_RESETS_PER_RUN = 200;

// Cron-реконсиляція бере той самий per-user білінг-лок, що й білінг-мутації.
// Лок звільняється швидко (критична секція обмежена батч-лімітом вище), тож
// кілька спроб з коротким бекофом перекривають типову контенцію; якщо холдер
// усе ще тримає лок — стемп `reconcileRequiredAt` (ставиться самим
// `reconcileUnderLock` ДО спроби локу) гарантує retry наступним daily-sweep-ом.
const RECONCILE_LOCK_MAX_ATTEMPTS = 5;
const RECONCILE_LOCK_RETRY_DELAY_MS = 200;

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
        private readonly usersService: UsersService,
        private readonly locks: RedisLockService
    ) {}

    /**
     * Реконсиляція під per-user білінг-локом (той самий ключ, що й
     * білінг-мутації у `PaymentsService`). Для тригерів, що НЕ тримають лок
     * самі: cron-сплини (`PaymentsCleanupService`) і видалення бізнесу
     * (`BusinessesController.delete`) — інакше вони конкурували б за
     * `accessBlockedAt` з grant-вебхуком того ж користувача (lost-update).
     * `reconcile` re-читає свіжий білінг-стан, тож серіалізований порядок не
     * важить — останній виконавець бачить фінальний стан.
     *
     * Ніколи не кидає: lock-контенція після ретраїв і reconcile-помилки —
     * best-effort лог; durable-retry гарантує `reconcileRequiredAt`-стемп,
     * який цей метод ставить САМ до спроби локу (див. нижче) і який добиває
     * daily-sweep. Холдери білінг-локу цей метод НЕ викликають — вони йдуть
     * напряму у `reconcile` (повторне взяття non-reentrant локу кинуло б busy).
     */
    async reconcileUnderLock(userId: string): Promise<void> {
        // Durable-маркер ДО спроби взяти лок: якщо всі ретраї впруться у
        // зайнятий лок або процес впаде, daily-sweep знайде стемп і добʼє
        // reconcile. Для cron-тригерів це дубль їхнього стемпа (нешкідливо),
        // для delete-тригера (`BusinessesController.delete`) — єдина
        // durable-гарантія. Повний reconcile знімає маркер сам (clear умовний
        // за startedAt, тож пізніший конкурентний стемп переживає). Для
        // користувача без білінг-субдока стемп no-op — durable-retry там
        // неможливий за схемою. Best-effort: збій стемпа не блокує саму спробу.
        try {
            await this.usersService.stampBillingReconcileRequired(userId);
        } catch (error) {
            this.logger.error(
                `Failed to stamp reconcileRequiredAt for user ${userId}`,
                error instanceof Error ? error.stack : String(error)
            );
        }
        for (
            let attempt = 1;
            attempt <= RECONCILE_LOCK_MAX_ATTEMPTS;
            attempt++
        ) {
            try {
                await this.locks.withLock(
                    billingLockKey(userId),
                    BILLING_LOCK_TTL_MS,
                    () => this.reconcile(userId)
                );
                return;
            } catch (error) {
                if (error instanceof RedisLockBusyError) {
                    if (attempt < RECONCILE_LOCK_MAX_ATTEMPTS) {
                        await delay(RECONCILE_LOCK_RETRY_DELAY_MS);
                        continue;
                    }
                    this.logger.warn(
                        `Reconcile deferred for user ${userId}: billing lock busy ` +
                            `after ${RECONCILE_LOCK_MAX_ATTEMPTS} attempts`
                    );
                    return;
                }
                this.logger.error(
                    `Reconciliation failed for user ${userId} (deferred to next trigger)`,
                    error instanceof Error ? error.stack : String(error)
                );
                return;
            }
        }
    }

    async reconcile(userId: string): Promise<void> {
        // Момент старту прогону — межа для умовного clear-у durable-маркера:
        // стемп, поставлений конкурентним cron-флипом ПІСЛЯ читання білінг-стану
        // нижче, мусить пережити зняття (цей прогін його флипу ще не бачив).
        const startedAt = new Date();
        const user = await this.usersService.findById(userId);
        if (!user) return;
        // Вікно deferred-старту: one-off уже сплив, а перше списання підписки
        // ще не прийшло — рівень тут рахувався б як none (TRIALING свідомо не
        // зараховується у deriveAccessLevel) і прогін незворотно скинув би
        // slug-и користувача, що вже оплатив продовження. Cron-сплин one-off
        // має цей guard у своєму $nor-фільтрі, але reconcile тригериться і поза
        // ним (видалення бізнесу, retryPendingReconciles, webhook-шлях) — тому
        // дзеркальний предикат тут, на єдиній точці входу. Відкладаємо зі
        // стемпом: daily-sweep добʼє, щойно вікно закриється (Approved → ACTIVE,
        // Declined → PAST_DUE, кинутий checkout → сплив grace).
        if (isAwaitingDeferredFirstCharge(user.billing, startedAt)) {
            await this.usersService.stampBillingReconcileRequired(userId);
            this.logger.log(
                `Reconcile deferred for user ${userId}: awaiting deferred first subscription charge`
            );
            return;
        }
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

        const businessIds = [...owned, ...client].map((b) => b._id);

        // Sprint 21 — демоція/промоція кастомного бренду під поточний рівень.
        // Це і є auto-apply після оплати: грант-вебхук → reconcileSafe →
        // промоція pending→active без окремого хука; згасання тарифу (cron/
        // refund/cancel) → демоція active→pending (файл лишається).
        await this.reconcileBrands(businessIds, level);

        // Slug-rent: нижче brand втрачається право на vanity-slug → скидаємо
        // кастомні slug-и бізнесів, реквізитів і рахунків до авто (ім'я
        // повертається ринку). brand/bookkeeper зберігають кастомні.
        // Ідемпотентно: після reset slugCustomized=false, повторний прогін не
        // чіпає. businessIds беремо з уже завантажених bucket-ів (без зайвого
        // запиту). Обсяг одного прогону обмежений батчем (TTL білінг-локу +
        // латентність webhook-шляху) — хвіст доганяється через стемп нижче.
        let slugRentComplete = true;
        if (!isAccessLevelAtLeast(level, 'brand') && businessIds.length > 0) {
            slugRentComplete = await this.runSlugRent(businessIds);
        }

        // Durable-маркер на білінгу: неповний прогін (батч-ліміт / збої
        // окремих reset-ів) → стемп, daily-sweep `PaymentsCleanupService`
        // доганяє; повний → знімаємо стемпи, поставлені ДО старту цього прогону
        // (cron-тригери, reconcileUnderLock). Clear умовний за `startedAt`:
        // стемп конкурентного cron-флипу, що приземлився після нашого читання
        // білінг-стану, переживає зняття — інакше той флип лишився б без
        // durable-retry. Для користувача без білінг-субдока стемп неможливий
        // ($set крізь null) і не потрібен — у нього немає cron-тригерів, які
        // могли б загубитись.
        if (user.billing) {
            if (slugRentComplete) {
                await this.usersService.clearBillingReconcileRequired(
                    userId,
                    startedAt
                );
            } else {
                await this.usersService.stampBillingReconcileRequired(userId);
                this.logger.warn(
                    `Slug-rent for user ${userId} incomplete (batch limit or ` +
                        `per-entity failures), stamped for daily retry`
                );
            }
        }
    }

    // ── Brand demote/promote (Sprint 21) ────────────────────────────────

    /**
     * Тримає слот кастомного бренду в актуальному стані під рівень доступу:
     *   - ≥ brand: промотує `pending → active` (логотип повертається публічно).
     *     Це і є auto-apply після оплати — окремий хук не потрібен.
     *   - < brand: демоутить `active → pending` зі свіжим `uploadedAt` (файл
     *     лишається; orphan-cron прибере, якщо підписку не поновлять у вікні).
     *
     * Атомарні bulk-update з aggregation-pipeline (один запит на весь набір),
     * ідемпотентні через filter-умови. Інваріант: `active` і `pending` не
     * співіснують у нормальному потоці (платний commit чистить pending,
     * deleteOrphanedFiles чистить файли) — тож промоція не перетирає чужий
     * pending, а демоція не лишає orphan-файлів попереднього pending.
     */
    private async reconcileBrands(
        businessIds: Types.ObjectId[],
        level: AccessLevel
    ): Promise<void> {
        if (businessIds.length === 0) return;

        if (isAccessLevelAtLeast(level, 'brand')) {
            await this.businessModel.updateMany(
                {
                    _id: { $in: businessIds },
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
            return;
        }

        await this.businessModel.updateMany(
            { _id: { $in: businessIds }, 'brand.active': { $ne: null } },
            [
                {
                    $set: {
                        'brand.pending': {
                            logoUrl: '$brand.active.logoUrl',
                            centerMarkUrl: '$brand.active.centerMarkUrl',
                            bandMarkUrl: '$brand.active.bandMarkUrl',
                            displayName: '$brand.active.displayName',
                            uploadedAt: '$$NOW',
                        },
                        'brand.active': null,
                    },
                },
            ]
        );
    }

    // ── Slug-rent reset (рівень нижче brand) ─────────────────────────────

    /**
     * Скидає кастомні slug-и трьох рівнів у межах спільного бюджету
     * (`SLUG_RENT_MAX_RESETS_PER_RUN`). Повертає true, якщо все скинуто
     * (бюджету вистачило і жоден reset не впав).
     */
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
        // Бюджет вичерпано попереднім рівнем — консервативно вважаємо прогін
        // неповним (зайвий no-op retry дешевший за exists-перевірку тут).
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
            // Бізнес зник між скануванням і TX (cascade-delete не під
            // білінг-локом): abort відкочує history-insert, інакше orphan-запис,
            // поставлений ПІСЛЯ cascade-зачистки history, блокував би звільнений
            // slug глобально до TTL.
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
            // Симетрично resetOneBusinessSlug: abort відкочує history-insert
            // для зниклої сутності.
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
            // Reset до random-slug-у без counter-нумерації: slugPreset/scope/
            // counter обнуляються (інвойс більше не counter-based), інакше stale
            // counter висів би у partial-unique-індексі.
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
            // Симетрично resetOneBusinessSlug: abort відкочує history-insert
            // для зниклої сутності.
            if (updated.matchedCount === 0) {
                throw new Error(
                    `Invoice ${invoiceId.toString()} vanished during slug reset`
                );
            }
        });
    }

    /**
     * Best-effort обгортка для per-entity slug-reset: збій одного не зриває
     * решту батча (slugCustomized лишається true, durable-стемп
     * `reconcileRequiredAt` гарантує retry). Повертає false на збій — caller
     * мітить прогін неповним.
     */
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
