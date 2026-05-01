import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SLUG_PRESETS, type SlugPreset } from '@finly/types';

export type InvoiceDocument = HydratedDocument<Invoice>;

/**
 * Інвойс — одноразова платіжка під конкретний бізнес ("Модель А", див.
 * `docs/product/qr-decisions.md` §1.12). У MVP схема навмисне НЕ містить полів
 * трекінгу оплат (`paidAt`, `transactions[]`, `paymentStatus`) — додавання
 * їх у Phase 1.5 буде через `$set` нового поля, без переписування існуючих
 * документів.
 *
 * Інваріанти, що НЕ виражаються Mongoose-валідатором:
 * - `validUntil < createdAt` — time-relative rule, app-layer (write-side service).
 * - `amount === null && amountLocked === true` — суперечливий стан; блокується
 *   Zod-схемою у `@finly/types/entities/invoice` на write-paths.
 *
 * Грошові суми зберігаються у копійках (int), не у float-гривнях — стандартна
 * практика payment-систем (Stripe, банки), що знімає floating-point bugs.
 */
@Schema({ timestamps: true })
export class Invoice {
    @Prop({ required: true, type: Types.ObjectId })
    businessId!: Types.ObjectId;

    /**
     * Slug per-invoice: `{людська-частина}-{8-char-tail}` або `{tail}`.
     * Генератор + slug-preset вибір — Sprint 3. Тут — структурна вимога БД:
     * NOT NULL + per-business unique (compound `{businessId, slug}`).
     */
    @Prop({ required: true, trim: true })
    slug!: string;

    /**
     * `null` — режим "клієнт сам вводить суму" (signage-mode у межах інвойсу).
     * Зберігається у копійках; min(0) на app-layer (Zod-схема контракту).
     */
    @Prop({ type: Number, default: null })
    amount!: number | null;

    @Prop({ required: true, default: false })
    amountLocked!: boolean;

    /**
     * `null` — наслідуємо `business.paymentPurposeTemplate`. Per-invoice
     * override (non-null) фіксує фактичний текст для конкретного інвойсу.
     */
    @Prop({ type: String, default: null })
    paymentPurpose!: string | null;

    @Prop({ type: Date, default: null })
    validUntil!: Date | null;

    /**
     * Аналітичне поле — який пресет згенерував slug. `null` — slug заданий
     * вручну (ФОП у явному режимі). Не впливає на бізнес-логіку.
     */
    @Prop({ type: String, enum: SLUG_PRESETS, default: null })
    slugPreset!: SlugPreset | null;

    @Prop({ type: Date, default: null })
    deletedAt!: Date | null;

    // Declared for TypeScript visibility; managed by Mongoose `timestamps: true`.
    createdAt!: Date;
    updatedAt!: Date;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);

InvoiceSchema.index({ businessId: 1, slug: 1 }, { unique: true });
InvoiceSchema.index({ businessId: 1, createdAt: -1 });
InvoiceSchema.index({ validUntil: 1 }, { sparse: true });
