import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { applyJsonTransform } from '../../../common/mongoose/json-transform';

export type InvoiceSlugHistoryDocument = HydratedDocument<InvoiceSlugHistory>;

/**
 * Sprint 15 — vanity-slug edit для Invoice (дзеркало `BusinessSlugHistory`).
 * Зберігає попередні slug-и інвойсу для двох сценаріїв:
 *
 *  1. **308-redirect збережених посилань.** Старе
 *     `pay.finly.com.ua/{biz}/{acc}/{oldInvoiceSlug}` після rename резолвиться
 *     fallback-ом у цю collection → поточний інвойс → `permanentRedirect()`.
 *     Композиційно з account-history: rename рахунку лагодить і вкладені
 *     invoice-посилання (сегмент рахунку резолвиться окремо перед інвойсом).
 *  2. **Anti-squatting у межах рахунку.** Поки старий slug у history (TTL =
 *     90 днів), його не можна зайняти іншому інвойсу **того самого рахунку**.
 *
 * **Самовідновлення на revert** — `InvoicesService.update` видаляє self-entry
 * `(invoiceId, slugLower=newLower)` перед insert-ом усередині TX.
 *
 * **Cascade-cleanup.** `BusinessesService.delete` → `deleteMany({businessId})`;
 * `InvoicesService.delete` → `deleteMany({invoiceId})`. `businessId`/`invoiceId`
 * denormalized саме для цих prefix-filter-ів.
 *
 * **TTL via Mongo background-thread** на `createdAt`. `slug` (case-preserved) не
 * зберігаємо — redirect target це поточний `invoice.slug`.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class InvoiceSlugHistory {
    @Prop({ required: true, type: Types.ObjectId, index: true })
    businessId!: Types.ObjectId;

    @Prop({ required: true, type: Types.ObjectId })
    accountId!: Types.ObjectId;

    @Prop({ required: true, type: Types.ObjectId, index: true })
    invoiceId!: Types.ObjectId;

    @Prop({ required: true, lowercase: true, trim: true })
    slugLower!: string;

    createdAt!: Date;
}

export const InvoiceSlugHistorySchema =
    SchemaFactory.createForClass(InvoiceSlugHistory);

applyJsonTransform(InvoiceSlugHistorySchema);

/**
 * Compound-unique `(accountId, slugLower)` — anti-squatting у межах рахунку +
 * race-guard на concurrent rename. Public invoice-lookup history-fallback теж
 * б'є по цьому індексу `(accountId, slugLower)`.
 */
InvoiceSlugHistorySchema.index(
    { accountId: 1, slugLower: 1 },
    { unique: true }
);

// TTL — 90 днів (узгоджено з Business/Account slug-history).
InvoiceSlugHistorySchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: 90 * 24 * 60 * 60 }
);
