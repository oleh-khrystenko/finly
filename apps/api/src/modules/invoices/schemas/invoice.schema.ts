import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SLUG_PRESETS, type SlugPreset } from '@finly/types';

import { applyJsonTransform } from '../../../common/mongoose/json-transform';

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

    /**
     * Sprint 4 §4.1 — counter-namespace string для preset-режимів з лічильником
     * (`'simple' | YYYY | 'YYYY-MM'`). `null` для `explicit` / `random` /
     * `with-purpose` (де counter не застосовується). Спільно з `slugCounter`
     * утворює compound-unique partial-index `(businessId, slugCounterScope,
     * slugCounter)` — гарантує atomic monotonic counter навіть у race-сценарії
     * паралельного створення двох інвойсів того самого пресету.
     *
     * **Чому окреме поле, а не парсинг `slug`-prefix-у при write.** Mongo не
     * підтримує partial-unique-index по derived/computed полях; physical
     * field-and-index — єдиний спосіб atomically блокувати counter-collision
     * на write-path. Без цього `(businessId, slug)` compound-unique пропускає
     * race (різні tails у генератор-output → різні slug-strings → не дублікат),
     * і retry-on-11000 у `InvoicesService.create` (SP-1 risk #2 mitigation)
     * не спрацював би.
     */
    @Prop({ type: String, default: null })
    slugCounterScope!: string | null;

    /**
     * Sprint 4 §4.1 — N (1, 2, 3, ...) у межах `slugCounterScope` для preset-
     * режимів з лічильником. `null` для inших режимів. Парний з
     * `slugCounterScope` — обидва завжди non-null або обидва null
     * (інваріант app-layer; не виражається Mongoose-валідатором).
     */
    @Prop({ type: Number, default: null })
    slugCounter!: number | null;

    @Prop({ type: Date, default: null })
    deletedAt!: Date | null;

    // Declared for TypeScript visibility; managed by Mongoose `timestamps: true`.
    createdAt!: Date;
    updatedAt!: Date;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);

// Sprint 4 §4.4 fix — JSON-serialization `_id: ObjectId → id: string`.
applyJsonTransform(InvoiceSchema);

InvoiceSchema.index({ businessId: 1, slug: 1 }, { unique: true });
InvoiceSchema.index({ businessId: 1, createdAt: -1 });
InvoiceSchema.index({ validUntil: 1 }, { sparse: true });

/**
 * Sprint 4 §4.1 — partial-unique compound для counter-presets-race-protection.
 *
 * **`partialFilterExpression`** включає документи лише з обома fields-not-null:
 * counter-presets (`simple`/`with-month`/`with-year`) — у index і unique-блокують
 * один-одного; non-counter modes (`explicit`/`random`/`with-purpose`) — поза
 * index-ом, не впливають на counter-namespace.
 *
 * **Race-сценарій, що блокується:** два паралельні `POST /invoices` під одним
 * бізнесом з пресетом `simple` читають `MAX(N)+1 = 1` одночасно і обидва
 * пробують insert з `slugCounter=1`. Один проходить, другий падає на
 * `code: 11000`; `InvoicesService.create` ловить його і retry-генерує наступний
 * номер (як SP-1 risk #2 mitigation описує). Без цього index-у обидва
 * insert-и проходили б (різні tails → різні `slug`-strings → не дублікат на
 * `(businessId, slug)` compound-unique), і у БД зʼявилися б два інвойси
 * `inv-001-...` з тим самим візуальним номером — порушення monotonic
 * invariant.
 */
InvoiceSchema.index(
    { businessId: 1, slugCounterScope: 1, slugCounter: 1 },
    {
        unique: true,
        partialFilterExpression: {
            slugCounterScope: { $type: 'string' },
            slugCounter: { $type: 'int' },
        },
    }
);
