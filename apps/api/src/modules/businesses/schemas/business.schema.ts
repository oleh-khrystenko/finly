import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
    BUSINESS_TYPES,
    TAXATION_SYSTEMS,
    type BusinessType,
    type TaxationSystem,
} from '@finly/types';

import { applyJsonTransform } from '../../../common/mongoose/json-transform';

export type BusinessDocument = HydratedDocument<Business>;

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
     * Soft-delete. Sprint 3 рішення C2 робить hard-delete + 5s frontend-Undo;
     * це поле залишене **навмисно невикористаним** на майбутнє — нульовий
     * coст у схемі, дає опцію передумати без міграції. Якщо у Phase 1.5+
     * вирішимо повернути soft-delete + restore — код consumer-ів не міняється.
     */
    @Prop({ type: Date, default: null })
    deletedAt!: Date | null;

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
