import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
    BUSINESS_TYPES,
    CATALOG_CATEGORIES,
    DEFAULT_CATALOG_CATEGORY,
    DEFAULT_PUBLICITY_STATUS,
    PUBLICITY_STATUSES,
    TAXATION_SYSTEMS,
    type BusinessType,
    type CatalogCategory,
    type PublicityStatus,
    type TaxationSystem,
} from '@finly/types';

import { applyJsonTransform } from '../../../common/mongoose/json-transform';

export type BusinessDocument = HydratedDocument<Business>;

/**
 * Sprint 21 — слот кастомного бренду отримувача. Тримає оригінальний логотип
 * (показ на pay-сторінках) і дві пре-композовані бренд-марки (bake-on-commit)
 * під дві позиції QR-рендеру. `displayName` — косметичний підпис; не платіжні
 * дані, у QR-payload не йде. Контракт shape — `@finly/types` `brandSlotSchema`.
 */
@Schema({ _id: false })
class BusinessBrandSlot {
    @Prop({ required: true })
    logoUrl!: string;

    @Prop({ required: true })
    centerMarkUrl!: string;

    @Prop({ required: true })
    bandMarkUrl!: string;

    @Prop({ type: String, default: null })
    displayName!: string | null;
}

/**
 * Pending-слот: ті самі поля плюс `uploadedAt` — мітка для cron-чистки orphan
 * pending-логотипів неоплачених (`pendingBrandSlotSchema` у `@finly/types`).
 */
@Schema({ _id: false })
class BusinessPendingBrandSlot {
    @Prop({ required: true })
    logoUrl!: string;

    @Prop({ required: true })
    centerMarkUrl!: string;

    @Prop({ required: true })
    bandMarkUrl!: string;

    @Prop({ type: String, default: null })
    displayName!: string | null;

    @Prop({ type: Date, required: true })
    uploadedAt!: Date;

    /**
     * Sprint 21 — `true`, якщо слот демоутований з `active` при згасанні тарифу
     * (довгий поріг cron-чистки); `false` — free-завантаження без оплати
     * (короткий поріг). Див. `pendingBrandSlotSchema` у `@finly/types`.
     */
    @Prop({ type: Boolean, required: true })
    demoted!: boolean;
}

/**
 * Sprint 21 — блок бренду з двома окремими слотами. `active` рендериться
 * публічно (лише коли рівень доступу не нижче brand — гейтинг на рендері);
 * `pending` чекає оплати або повернення доступу. Демоція active→pending при
 * втраті доступу і промоція назад — на реконсиляції (стан слотів тримає вона,
 * публічний анонімний рендер entitlement наживо не резолвить).
 */
@Schema({ _id: false })
class BusinessBrand {
    @Prop({ type: BusinessBrandSlot, default: null })
    active!: BusinessBrandSlot | null;

    @Prop({ type: BusinessPendingBrandSlot, default: null })
    pending!: BusinessPendingBrandSlot | null;
}

/**
 * Sprint 9 §SP-1 — `requisites`-subdoc видалено. `iban` переїхав на окрему
 * сутність `Account`; `taxId` — top-level поле Business (юр-property платника,
 * не банківського рахунку). `invoiceSlugPresetDefault` теж переїхав на Account
 * (інвойсна нумерація per-account, §SP-6).
 */

@Schema({ timestamps: true })
export class Business {
    @Prop({ required: true, type: String, enum: BUSINESS_TYPES })
    type!: BusinessType;

    /**
     * `null` — валідний стан "бізнес без власника" (створений у режимі
     * бухгалтера для клієнта, який ще не зареєстрований у Finly). Інваріант
     * `ownerId === null ⇒ managers.length ≥ 1` живе на app-layer (Zod-refine
     * у `@finly/types` + service-layer assertion у Sprint 3) — Mongoose
     * валідатор комбінаторного правила не виразить.
     */
    @Prop({ type: Types.ObjectId, default: null })
    ownerId!: Types.ObjectId | null;

    @Prop({ type: [Types.ObjectId], default: [] })
    managers!: Types.ObjectId[];

    /**
     * Display-форма slug-а у регістрі, як його зафіксував ФОП (Sprint 3
     * рішення E1: case-preserved). Жодного `lowercase: true` modifier — saver
     * у `BusinessesService` явно нормалізує `slugLower` окремо. Уніфікація
     * `slugLower` робить case-insensitive uniqueness; цей `slug` — суто для
     * рендеру (URL у QR, сторінка кабінету, canonical-redirect target).
     *
     * Reserved-list check (`qr`, `api`, `host-pay`, …) і unique-перевірка —
     * на app-layer (slug-генератор + unique-index на `slugLower`).
     */
    @Prop({ required: true, trim: true })
    slug!: string;

    /**
     * Lowercase-нормалізована форма `slug`. Single source of truth для
     * case-insensitive uniqueness і lookup-у на public-сторінці. Mongoose
     * unique-index створюється саме тут (нижче, через `BusinessSchema.index`).
     *
     * Інваріант `slugLower === slug.toLowerCase()` enforce-иться у
     * `BusinessesService.create / update` (Sprint 3 §3.2). Mongoose
     * pre-save-хук **навмисно не ставимо** — service-layer normalization
     * явніша і тестується ізольовано (sprint plan §3.1).
     */
    @Prop({ required: true, lowercase: true, trim: true })
    slugLower!: string;

    /**
     * Sprint 19 — чи slug вручну кастомізований користувачем (vanity). `false`
     * для авто-згенерованих (create / reset-slug). Реконсиляція при падінні
     * нижче brand скидає лише кастомні slug-и до авто (rent-модель: «красиві»
     * імена повертаються ринку), не чіпаючи й так-авто. Internal-флаг, не у
     * публічному контракті.
     */
    @Prop({ type: Boolean, default: false })
    slugCustomized!: boolean;

    @Prop({ required: true, trim: true })
    name!: string;

    /**
     * Sprint 9 §SP-1 — top-level `taxId` (раніше `requisites.taxId`). Format-
     * валідація (RNOKPP 10-digit з checksum для individual/fop; ЄДРПОУ 8-digit
     * для tov/organization) — на Zod write-DTO (`payerTaxIdZod` union) +
     * service-layer cross-check проти document-resident `type` (Sprint 7 §SP-4).
     * Mongoose не дублює — single source of truth.
     */
    @Prop({ required: true, trim: true })
    taxId!: string;

    /**
     * Система оподаткування ФОП / ТОВ. Coupled-валідація з `isVatPayer` (ПДВ
     * дозволено лише на `simplified-3` / `general`) живе у Zod-refine
     * `BusinessSchema` + write-DTO; Mongoose тут забезпечує лише структурний
     * enum-guard.
     *
     * **Sprint 7 §SP-3 — nullable.** `null` для типів без оподаткування
     * (`individual`, `organization`); non-null для `fop` / `tov`. Coupled-rule
     * `requiresTaxation(type) ⇔ both-non-null` живе у Zod entity-refine
     * (`TAXATION_FIELDS_MISMATCH_TYPE`) + write-DTO discriminated union, не на
     * Mongoose-layer (комбінаторне правило з parent-context Mongoose-валідатор
     * не виразить). `default: null` тут — щоб individual/organization-документи
     * на `Model.create({ ...dto })` отримували чисте null без ручного
     * service-нормалізатора-everywhere; для fop/tov write-DTO discriminated
     * union вимагає поле явно (clear semantics).
     */
    @Prop({
        required: false,
        type: String,
        enum: TAXATION_SYSTEMS,
        default: null,
    })
    taxationSystem!: TaxationSystem | null;

    /**
     * Платник ПДВ. Sprint 7 §SP-3 — nullable, симетрично до `taxationSystem`.
     * Coupled-rule з `taxationSystem` enforce-иться на write-paths (Zod), не
     * на DB-layer. `default: null` — для individual/organization, де поле
     * семантично не застосовується.
     */
    @Prop({ type: Boolean, default: null })
    isVatPayer!: boolean | null;

    @Prop({ required: true, trim: true })
    paymentPurposeTemplate!: string;

    /**
     * Чи показувати публічну сторінку у Google (Sprint 3 рішення E3). Default
     * `false` — безпечний дефолт; ФОП явно opt-in-ить через toggle у кабінеті.
     * Sprint 3 toggle доступний усім; Sprint 6 додасть Paid-gating.
     */
    @Prop({ type: Boolean, default: false })
    seoIndexEnabled!: boolean;

    /**
     * Sprint 29 — системний отримувач, створений адміном (податкова, фонди).
     * `true` ⇒ `ownerId: null` + `managers: []` (нічий, керується лише адмінкою),
     * маркери підстановки у `paymentPurposeTemplate` дозволені. Запис невидимий
     * для claim-flow, бухгалтерських вибірок і orphan-cleanup (ті ходять через
     * `ownerId`/`managers`, які тут порожні). Дефолт `false` — усі наявні бізнеси
     * звичайні.
     */
    @Prop({ type: Boolean, default: false })
    isSystem!: boolean;

    /**
     * Sprint 29 — чи отримувач видимий у публічному каталозі. Гранулярна
     * публічність: власний прапор також на кожних реквізитах (`Account.
     * catalogVisible`). Глибше не йде: документ це персональний виставлений
     * рахунок, у каталозі йому місця немає. Дефолт прихований; допуск у каталог
     * додатково вимагає красивого slug (окремий зріз).
     */
    @Prop({ type: Boolean, default: false })
    catalogVisible!: boolean;

    /**
     * Sprint 29 — стан запиту на публічність. Звичайний бізнес потрапляє у
     * каталог лише через `approved`; системний — без запиту (лишається `none`).
     */
    @Prop({
        type: String,
        enum: PUBLICITY_STATUSES,
        default: DEFAULT_PUBLICITY_STATUS,
    })
    publicityStatus!: PublicityStatus;

    @Prop({ type: Date, default: null })
    publicityRequestedAt!: Date | null;

    @Prop({ type: Date, default: null })
    publicityReviewedAt!: Date | null;

    @Prop({ type: String, default: null })
    publicityRejectionReason!: string | null;

    /**
     * Sprint 29 — категорія-секція у публічному каталозі. Призначає адмін
     * (системним при створенні, користувацьким при схваленні). Дефолт `business`.
     */
    @Prop({
        type: String,
        enum: CATALOG_CATEGORIES,
        default: DEFAULT_CATALOG_CATEGORY,
    })
    catalogCategory!: CatalogCategory;

    /**
     * Soft-delete. Sprint 3 рішення C2 робить hard-delete + 5s frontend-Undo;
     * це поле залишене **навмисно невикористаним** на майбутнє — нульовий
     * coст у схемі, дає опцію передумати без міграції. Якщо у Phase 1.5+
     * вирішимо повернути soft-delete + restore — код consumer-ів не міняється.
     */
    @Prop({ type: Date, default: null })
    deletedAt!: Date | null;

    /**
     * Sprint 27 — денормалізований прапор «бізнес у активному Бренд-складі».
     * `null` — бренд-фічі (кастомний slug, логотип) вимкнені; timestamp —
     * бізнес прикріплений хоча б до одного активного Бренд-складу платника.
     * Підтримує реконсиляція per-business (`ReconciliationService.reconcile-
     * Businesses`); гейтинг slug/логотипа і публічний рендер читають саме цей
     * прапор, не резолвлячи entitlement наживо. Живе, поки лишається хоч одне
     * активне прикріплення (кілька платників за один бізнес — валідно).
     */
    @Prop({ type: Date, default: null })
    brandedAt!: Date | null;

    /**
     * Sprint 21 — кастомний брендинг отримувача. `null` — бренду немає, скрізь
     * Finly. Два слоти (`active`/`pending`) — щоб перенести намір через checkout
     * (як slug-upsell, без броні й таймера) і пережити згасання тарифу без
     * втрати файлу. Стан слотів тримає реконсиляція; публічний рендер довіряє
     * `active`-слоту, не резолвить entitlement наживо.
     */
    @Prop({ type: BusinessBrand, default: null })
    brand!: BusinessBrand | null;

    /**
     * Sprint 10 §SP-11 — anti-duplicate-Business UUID v4 token для anon-claim
     * flow. Frontend генерує `crypto.randomUUID()` на CTA-click "Зберегти у
     * кабінет" і прокидає у `POST /businesses/me` (через magic-link Redis-record-у
     * або напряму на same-device-flow). Backend дедуплікує через partial-unique-
     * compound-index `(ownerId, claimIdempotencyKey)` нижче.
     *
     * **Optional у документі**, бо cabinet-wizard-create НЕ передає key —
     * поле відсутнє у документі, не входить у `partialFilterExpression`, не
     * блокує множинні cabinet-create без anon-claim-context-у.
     */
    @Prop({ type: String, required: false })
    claimIdempotencyKey?: string;

    // Declared for TypeScript visibility; managed by Mongoose `timestamps: true`.
    createdAt!: Date;
    updatedAt!: Date;
}

export const BusinessSchema = SchemaFactory.createForClass(Business);

// Sprint 4 §4.4 fix — JSON-serialization `_id: ObjectId → id: string` + strip
// `__v`. Без цього frontend `Business.id` (Zod-entity-shape) була б
// undefined, що ламало React `key={b.id}` і dedup-логіки за `id`.
applyJsonTransform(BusinessSchema);

// Unique-index — на `slugLower`, не на `slug` (Sprint 3 рішення E1:
// case-insensitive uniqueness). `slug` лишається без index — пошук завжди
// йде через `slugLower`; canonical-redirect на public-сторінці порівнює
// case-preserved `slug` уже після lookup-у.
BusinessSchema.index({ slugLower: 1 }, { unique: true });
BusinessSchema.index({ ownerId: 1 }, { sparse: true });
BusinessSchema.index({ managers: 1 });

// Унікальність `taxId` у межах користувача, per-type. Два partial-індекси, бо
// scope власності подвійний і в одному ключі не виражається:
//  - owned: `(ownerId, taxId, type)`, тільки документи з ObjectId-власником;
//  - клієнтські бухгалтера: `(managers, taxId, type)` (multikey — uniqueness
//    per-елемент масиву), тільки `ownerId: null`-документи.
// Глобальної унікальності НЕМАЄ навмисно: різні користувачі легітимно ведуть
// той самий реальний бізнес (ФОП сам + його бухгалтер), а верифікації
// власності коду не існує — глобальний індекс дозволив би squatting чужого
// ЄДРПОУ. `type` у ключі дозволяє пару individual+fop з одним РНОКПП (той
// самий номер однієї людини). Primary-check — service-layer (create під
// per-user локом, PATCH з pre-read); індекси закривають race-window.
BusinessSchema.index(
    { ownerId: 1, taxId: 1, type: 1 },
    {
        unique: true,
        partialFilterExpression: { ownerId: { $type: 'objectId' } },
    }
);
BusinessSchema.index(
    { managers: 1, taxId: 1, type: 1 },
    {
        unique: true,
        partialFilterExpression: { ownerId: { $type: 'null' } },
    }
);

// Sprint 21 — cron-чистка orphan pending-логотипів неоплачених шукає бізнеси з
// `brand.pending.uploadedAt` старішим за поріг. Sparse: переважна більшість
// бізнесів без pending-бренду взагалі не потрапляють в index.
BusinessSchema.index({ 'brand.pending.uploadedAt': 1 }, { sparse: true });

// Sprint 29 — черга запитів на публічність (адмінка). Partial-index лише на
// pending: черга завжди фільтрує саме цей стан, а переважна більшість бізнесів
// (none/approved) в index не потрапляє. Сортування за requestedAt — найстаріші
// зверху.
BusinessSchema.index(
    { publicityStatus: 1, publicityRequestedAt: 1 },
    { partialFilterExpression: { publicityStatus: 'pending' } }
);

// Sprint 29 — список схвалених користувацьких отримувачів (адмінка). Partial-
// index на `approved` окремо від pending-черги: partial-index під pending для
// цього запиту непридатний (предикат `approved` не імплікує filter-expression),
// тож без нього вибірка йшла б COLLSCAN-ом по бізнесах усіх користувачів з
// blocking sort. Компаунд з `publicityReviewedAt` дає ще й порядок сортування.
BusinessSchema.index(
    { publicityStatus: 1, publicityReviewedAt: -1 },
    { partialFilterExpression: { publicityStatus: 'approved' } }
);

// Sprint 29 — список системних отримувачів (адмінка). Partial: системних
// записів одиниці на всю колекцію, тож index малий, а без нього кожен рендер
// адмін-списку сканував би всі бізнеси продукту.
BusinessSchema.index(
    { isSystem: 1, createdAt: -1 },
    { partialFilterExpression: { isSystem: true } }
);

// Sprint 29 — запит публічного каталогу (головна pay-хоста, гаряча path).
// Partial-index лише на `catalogVisible: true` — найселективніший предикат
// фільтра каталогу: у ньому лише куровані/схвалені-і-увімкнені записи, тобто
// index не читає всю колекцію бізнесів. Компаунд з `name` дає ще й порядок для
// `sort({ name: 1 })`; решту предикатів (`slugCustomized`, `isSystem`/
// `publicityStatus: approved`, `deletedAt`) Mongo фільтрує вже над цим малим
// кандидат-сетом. Без нього кожен рендер головної робив би COLLSCAN, вартість
// якого росла б з повною кількістю бізнесів усіх користувачів.
BusinessSchema.index(
    { catalogVisible: 1, name: 1 },
    { partialFilterExpression: { catalogVisible: true } }
);

// Sprint 10 §SP-11 — partial-unique `(ownerId, claimIdempotencyKey)` для
// anon-claim dedup. `partialFilterExpression: { claimIdempotencyKey: { $type:
// 'string' } }` критично: без нього sparse-index плутав би null-key документи
// (cabinet wizard-create) у один null-bucket → друге wizard-create без anon-
// claim упало б на 11000. Partial-filter включає тільки документи з
// claimIdempotencyKey-string-ом — anon-claim-flow єдиний consumer.
BusinessSchema.index(
    { ownerId: 1, claimIdempotencyKey: 1 },
    {
        unique: true,
        partialFilterExpression: {
            claimIdempotencyKey: { $type: 'string' },
        },
    }
);
