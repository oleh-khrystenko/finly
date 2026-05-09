import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { applyJsonTransform } from '../../../common/mongoose/json-transform';

export type InvoiceSlugCounterDocument = HydratedDocument<InvoiceSlugCounter>;

/**
 * Sprint 4 §4.1 — окрема counter-колекція для invoice-slug-генератора.
 *
 * **Чому окрема колекція, а не `MAX(slugCounter)+1` по invoice-документах**
 * (Sprint 4 review fix після виявлення дефекту "counter reuse after delete"):
 *
 * Попередня реалізація рахувала наступний counter як `MAX(slugCounter)+1`
 * over committed invoice-документів. Це зламано на hard-delete-flow:
 *   1. Створили `inv-001`, `inv-002`, `inv-003`.
 *   2. ФОП видалив `inv-003` (5s-undo flow або cascade).
 *   3. Наступний invoice з `simple`-пресетом → `MAX = 2` → counter = 3
 *      → візуально знову `inv-003-{newTail}`.
 * Заявлений інваріант "monotonic per (business, scope)" не виконується;
 * номери у URL ФОП-а можуть повторюватися після нормальної дії.
 *
 * Окремий counter-doc розв'язує root-cause: counter живе незалежно від
 * invoice lifecycle. Hard-delete invoice не торкає counter — `last`
 * залишається 3, наступне allocate-ня → 4. Це стандартний pattern,
 * структурно еквівалентний SQL `SEQUENCE`.
 *
 * **Allocation flow** (детальний контракт у `InvoiceSlugGeneratorService.
 * allocateNextCounter`):
 *   - **Step 1 fast-path:** `findOneAndUpdate({...}, {$inc: { last: 1 }})`
 *     БЕЗ `upsert`. На existing counter-doc-у — атомарний інкремент,
 *     concurrent calls серіалізуються write-conflict-detection-ом.
 *   - **Step 2 lazy-bootstrap:** якщо doc ще не існує, обчислюємо
 *     `legacyMax = MAX(slugCounter)` over invoices у тому ж scope-i і
 *     роbимо `create({ last: legacyMax + 1 })`. Greenfield → `last=1`;
 *     post-deploy на existing data → `last=legacyMax+1` (skip-аємо за
 *     legacy values, щоб не collide-ити з partial-unique compound на
 *     invoice-схемі). Concurrent bootstrap → 11000 propagate назовні
 *     (НЕ retry у тій самій TX-сесії — duplicate-key abort-ить TX);
 *     `InvoicesService.create` outer-loop ловить і повторює з fresh
 *     session, де fast-path step 1 уже бачить committed counter-doc.
 *
 * **Session-binding.** Counter-allocation викликається з-середини
 * invoice-create-transaction-у з тією ж `ClientSession`: TX abort (race з
 * cascade-delete виграв, validation fail після allocate) → counter
 * rollback разом з invoice. Без сесії counter інкремент лідалив би
 * незалежно — gap-и без причини.
 *
 * **Transient WriteConflict on `$inc`.** Два concurrent transactions, що
 * `$inc` ОДИН той самий counter-doc, тригерять `WriteConflict` на один з
 * них; Mongo ставить `TransientTransactionError` label, `withTransaction`
 * автоматично retry-ить — без втрати correctness.
 *
 * **Cascade-delete контракт.** `BusinessesService.delete` видаляє counter-
 * docs разом з invoices+business у тій самій TX — orphan-counter-doc-и
 * не накопичуються.
 *
 * **Backwards-compat без migration.** Поля `slugCounterScope`/`slugCounter`
 * на `Invoice`-схемі залишаються (analytics + partial-unique compound як
 * defense-in-depth). Lazy-bootstrap читає `MAX(slugCounter)` over existing
 * invoices при першому allocate per scope і стартує counter за legacy MAX.
 * Без bootstrap-у counter стартував би з 1 і колидив би з existing
 * invoices через partial-unique compound 11000, exhaust-уючи `MAX_RETRIES`
 * на business-ах з 4+ invoices у scope-i.
 */
@Schema({ timestamps: true })
export class InvoiceSlugCounter {
    @Prop({ required: true, type: Types.ObjectId })
    businessId!: Types.ObjectId;

    /**
     * Counter namespace per `Invoice.slugCounterScope` semantics:
     * `'simple' | YYYY | 'YYYY-MM'`. Кодується string-ом (не enum-ом), бо
     * year/month-варіанти нескінченні.
     */
    @Prop({ required: true, type: String })
    scope!: string;

    /**
     * Останній allocated counter у цьому scope-і. На першому allocate
     * (lazy-bootstrap) ініціалізується через `create({ last: legacyMax+1 })`
     * — для greenfield = 1, для post-deploy на existing data = MAX over
     * legacy invoices + 1. Subsequent allocate-нь — fast-path `$inc: 1`.
     * Monotonic зростання незалежно від invoice deletes (counter-doc живе
     * у власній колекції, не зачіпається hard-delete-ом invoice-ів).
     */
    @Prop({ required: true, type: Number })
    last!: number;

    createdAt!: Date;
    updatedAt!: Date;
}

export const InvoiceSlugCounterSchema =
    SchemaFactory.createForClass(InvoiceSlugCounter);

applyJsonTransform(InvoiceSlugCounterSchema);

/**
 * Unique compound `(businessId, scope)` — один counter-doc per scope per
 * business. Concurrent bootstrap-`create`-и на одну й ту саму пару
 * серіалізуються через цей index: один проходить, інший падає з 11000
 * (propagate-иться у `InvoicesService.create` outer-loop — fresh session
 * на retry). На subsequent `$inc`-ах одного й того ж doc-у — write-write-
 * conflict-detection (Mongo TX retry-ить TransientTransactionError автоматично).
 */
InvoiceSlugCounterSchema.index({ businessId: 1, scope: 1 }, { unique: true });
