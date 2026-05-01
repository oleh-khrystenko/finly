import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
    BUSINESS_TYPES,
    MVP_BANKS,
    type BankCode,
    type BusinessType,
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
     * Глобально-унікальний slug у форматі kebab-case-lowercase. Generation +
     * reserved-list check (`qr`, `api`, `static`, …) — slug-генератор у
     * Sprint 3. Тут — структурна вимога БД: NOT NULL + unique index.
     */
    @Prop({ required: true, lowercase: true, trim: true })
    slug!: string;

    @Prop({ required: true, trim: true })
    name!: string;

    @Prop({ type: BusinessRequisites, required: true })
    requisites!: BusinessRequisites;

    @Prop({ required: true, trim: true })
    paymentPurposeTemplate!: string;

    @Prop({
        type: [{ type: String, enum: MVP_BANKS }],
        default: [],
    })
    acceptedBanks!: BankCode[];

    /**
     * Soft-delete. Hard-delete + cron — Phase 1.5+; зараз лише поле, без
     * фонової логіки. Це позицує дані-модель готовою до hard-delete без
     * міграції.
     */
    @Prop({ type: Date, default: null })
    deletedAt!: Date | null;

    // Declared for TypeScript visibility; managed by Mongoose `timestamps: true`.
    createdAt!: Date;
    updatedAt!: Date;
}

export const BusinessSchema = SchemaFactory.createForClass(Business);

BusinessSchema.index({ slug: 1 }, { unique: true });
BusinessSchema.index({ ownerId: 1 }, { sparse: true });
BusinessSchema.index({ managers: 1 });
