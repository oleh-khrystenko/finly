import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
    BUSINESS_TYPES,
    MVP_BANKS,
    TAXATION_SYSTEMS,
    type BankCode,
    type BusinessType,
    type TaxationSystem,
} from '@finly/types';

export type BusinessDocument = HydratedDocument<Business>;

/**
 * Реквізити бізнесу. У MVP підтримуємо лише ФОП-варіант (`iban` + `taxId`).
 * Розширення під ТОВ/ВАТ (`edrpou`, `vatNumber`, …) — Phase 1.5+; для цього
 * subdoc живе як окремий клас, а не inline-fields у `Business`.
 *
 * Format-валідація IBAN/ІПН (MOD-97, control-digit) виконується Zod-шаром
 * `@finly/types/validation` на write-paths (DTO, форми). Mongoose тут не дублює
 * перевірку — single source of truth уникає розходжень при майбутніх змінах
 * правил.
 */
@Schema({ _id: false })
class BusinessRequisites {
    @Prop({ required: true, trim: true })
    iban!: string;

    @Prop({ required: true, trim: true })
    taxId!: string;
}

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

    @Prop({ type: BusinessRequisites, required: true })
    requisites!: BusinessRequisites;

    /**
     * Система оподаткування ФОП (Sprint 3 рішення C1). Coupled-валідація з
     * `isVatPayer` (ПДВ дозволено лише на `simplified-3` / `general`) живе у
     * Zod-refine `BusinessSchema` + write-DTO; Mongoose тут забезпечує лише
     * структурний enum-guard.
     */
    @Prop({ required: true, type: String, enum: TAXATION_SYSTEMS })
    taxationSystem!: TaxationSystem;

    /**
     * Платник ПДВ (Sprint 3 C1). Default `false` — більшість ФОП на спрощеній
     * системі без ПДВ. Coupled-rule з `taxationSystem` enforce-иться на
     * write-paths (Zod), не на DB-layer.
     */
    @Prop({ type: Boolean, default: false })
    isVatPayer!: boolean;

    @Prop({ required: true, trim: true })
    paymentPurposeTemplate!: string;

    @Prop({
        type: [{ type: String, enum: MVP_BANKS }],
        default: [],
    })
    acceptedBanks!: BankCode[];

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

    // Declared for TypeScript visibility; managed by Mongoose `timestamps: true`.
    createdAt!: Date;
    updatedAt!: Date;
}

export const BusinessSchema = SchemaFactory.createForClass(Business);

// Unique-index — на `slugLower`, не на `slug` (Sprint 3 рішення E1:
// case-insensitive uniqueness). `slug` лишається без index — пошук завжди
// йде через `slugLower`; canonical-redirect на public-сторінці порівнює
// case-preserved `slug` уже після lookup-у.
BusinessSchema.index({ slugLower: 1 }, { unique: true });
BusinessSchema.index({ ownerId: 1 }, { sparse: true });
BusinessSchema.index({ managers: 1 });
