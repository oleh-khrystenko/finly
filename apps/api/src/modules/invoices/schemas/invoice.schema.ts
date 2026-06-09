import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SLUG_PRESETS, type SlugPreset } from '@finly/types';

import { applyJsonTransform } from '../../../common/mongoose/json-transform';

export type InvoiceDocument = HydratedDocument<Invoice>;

/**
 * Sprint 4 review fix — embedded subdoc, що фрозить платіжні реквізити на
 * момент створення інвойсу. NBU/QR payload public-зони будується з цього
 * snapshot-у, а не з runtime-mutable Business/Account — фікс для дефекту
 * "ФОП редагує IBAN, старе invoice-посилання тихо начинає вести на новий
 * payload".
 *
 * **Поля snapshot-у** (Sprint 9 §SP-6 — джерела оновлено після розщеплення
 * Business на Business + Account):
 *  - `recipientName` — `business.name` на момент create.
 *  - `iban` — `account.iban` на момент create (раніше `business.requisites.
 *    iban`; Sprint 9 переніс IBAN на окрему сутність Account).
 *  - `taxId` — `business.taxId` на момент create (раніше `business.requisites.
 *    taxId`; Sprint 9 flatten-ув requisites-wrapper у top-level taxId).
 *  - `paymentPurpose` — effective purpose, resolved через
 *    `effectiveInvoicePurpose(dto.paymentPurpose, business.paymentPurposeTemplate)`
 *    на момент create.
 *
 * **`_id: false`** — embedded subdoc-у власний `_id` не потрібен, ці дані
 * не запит-ються незалежно від parent invoice.
 */
@Schema({ _id: false })
export class InvoicePayeeSnapshot {
    @Prop({ required: true, type: String, trim: true })
    recipientName!: string;

    @Prop({ required: true, type: String, trim: true })
    iban!: string;

    @Prop({ required: true, type: String, trim: true })
    taxId!: string;

    @Prop({ required: true, type: String, trim: true })
    paymentPurpose!: string;
}

const InvoicePayeeSnapshotSchema =
    SchemaFactory.createForClass(InvoicePayeeSnapshot);

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
    /**
     * Sprint 9 §SP-6 — invoice nest-иться під Account (`accountId` required).
     * `businessId` залишається як denormalized field (set on insert з
     * `account.businessId`, immutable). Дозволяє прямий
     * `Invoice.deleteMany({businessId})` у cascade-delete-business + analytical-
     * запити без `$lookup` через accounts.
     */
    @Prop({ required: true, type: Types.ObjectId })
    businessId!: Types.ObjectId;

    @Prop({ required: true, type: Types.ObjectId })
    accountId!: Types.ObjectId;

    /**
     * Slug per-invoice. Sprint 15 — редаговуваний vanity-string (раніше
     * immutable). Display case-preserved; uniqueness/lookup на `slugLower`.
     * Create генерує `{людська-частина}-{8-char-tail}` / `{tail}`; ФОП може
     * перейменувати у кабінеті.
     */
    @Prop({ required: true, trim: true })
    slug!: string;

    /**
     * Sprint 15 — lowercase-нормалізована форма `slug`. Compound-unique
     * `(accountId, slugLower)` — case-insensitive uniqueness у межах рахунку.
     */
    @Prop({ required: true, trim: true, lowercase: true })
    slugLower!: string;

    /**
     * Sprint 19 — чи slug вручну кастомізований (vanity). `false` для авто
     * (create / reset). Реконсиляція скидає лише кастомні при падінні нижче
     * brand. Internal-флаг.
     */
    @Prop({ type: Boolean, default: false })
    slugCustomized!: boolean;

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

    /**
     * Sprint 4 review fix — embedded snapshot платіжних реквізитів. На нових
     * invoices завжди non-null (`InvoicesService.create` populate-ить).
     * `null` лишається валідним станом для legacy invoices, створених до
     * Sprint 4 review fix; payload-mapper має fallback на live business у
     * цьому випадку. Migration `2026-05-08-invoices-payee-snapshot.ts`
     * backfill-ить snapshot для existing invoices з current business state.
     */
    @Prop({ type: InvoicePayeeSnapshotSchema, default: null })
    payeeSnapshot!: InvoicePayeeSnapshot | null;

    @Prop({ type: Date, default: null })
    deletedAt!: Date | null;

    // Declared for TypeScript visibility; managed by Mongoose `timestamps: true`.
    createdAt!: Date;
    updatedAt!: Date;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);

// Sprint 4 §4.4 fix — JSON-serialization `_id: ObjectId → id: string`.
applyJsonTransform(InvoiceSchema);

/**
 * Sprint 15 — invoice-uniqueness переходить з `(accountId, slug)` на
 * `(accountId, slugLower)`: case-insensitive у межах рахунку (vanity-slug
 * редаговуваний). Два account-и одного бізнесу можуть мати інвойс з однаковим
 * slug-string-ом (per-account namespace). Міграція
 * `2026-06-03-nested-slug-lower` drop-ає старий `(accountId, slug)` unique.
 */
InvoiceSchema.index({ accountId: 1, slugLower: 1 }, { unique: true });

/**
 * Sprint 9 — primary list-pagination index переходить на `(accountId,
 * createdAt: -1, _id: -1)` — той самий tie-break invariant, що Sprint 4, але
 * у новому per-account namespace.
 */
InvoiceSchema.index({ accountId: 1, createdAt: -1, _id: -1 });

/**
 * Sprint 9 — non-unique `(businessId, createdAt -1)` залишається для cascade-
 * delete-business filter-у і analytical-запитів "усі інвойси бізнесу" без
 * `$lookup` через accounts.
 */
InvoiceSchema.index({ businessId: 1, createdAt: -1 });

InvoiceSchema.index({ validUntil: 1 }, { sparse: true });

/**
 * Sprint 9 §SP-6 — partial-unique compound `(accountId, slugCounterScope,
 * slugCounter)` race-блокує counter-collision на write-path у per-account
 * namespace. Privat і Mono account-и одного бізнесу мають незалежні counter-
 * послідовності (`'simple'` counter=1 у обох — дозволено).
 */
InvoiceSchema.index(
    { accountId: 1, slugCounterScope: 1, slugCounter: 1 },
    {
        unique: true,
        partialFilterExpression: {
            slugCounterScope: { $type: 'string' },
            slugCounter: { $type: 'int' },
        },
    }
);
