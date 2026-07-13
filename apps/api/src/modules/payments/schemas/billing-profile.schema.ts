import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BillingProfileDocument = HydratedDocument<BillingProfile>;

export type BillingProfileLean = BillingProfile & { _id: Types.ObjectId };

/**
 * Кредитний рахунок документного складу. `balance` — доступні кредити;
 * `storageBytesUsed` — фактичне використання сховища (для ренти понад базу,
 * майбутній спринт сховища). Книга операцій — окрема append-only колекція
 * (`CreditLedgerEntry`), тут лише поточний зріз.
 */
@Schema({ _id: false })
class CreditAccount {
    @Prop({ required: true, default: 0, min: 0 })
    balance!: number;

    @Prop({ required: true, default: 0, min: 0 })
    storageBytesUsed!: number;
}

/**
 * Склад «Бренд»: ємність (кількість оплачених поштучних слотів) + прикріплені
 * бізнеси. Інваріант `attachedBusinessIds.length ≤ capacity` тримає сервіс.
 * Ціна складу = ємність × поштучна ціна (не залежить від кількості прикріплених).
 */
@Schema({ _id: false })
class BrandWarehouse {
    @Prop({ required: true, default: 0, min: 0 })
    capacity!: number;

    @Prop({ type: [Types.ObjectId], default: [] })
    attachedBusinessIds!: Types.ObjectId[];

    /**
     * Відкладене зменшення ємності: `null` — немає; число ≥0 — застосувати цю
     * ємність на межі наступного циклу (0 = прибрати всесвіт). Поточний цикл уже
     * оплачено, тож зменшення діє лише з наступного списання, без повернень.
     */
    @Prop({ type: Number, default: null })
    pendingCapacity!: number | null;

    /**
     * Які прикріплення лишаються в межах нової (меншої) ємності. Порожній —
     * система лишить найперші за порядком прикріплення; зайві відкріпляться
     * автоматично на межі циклу.
     */
    @Prop({ type: [Types.ObjectId], default: [] })
    pendingKeepBusinessIds!: Types.ObjectId[];
}

/**
 * Склад «Документи»: активний пакет (`tierSize`, ємність = розмір пакета) +
 * прикріплені бізнеси + кредитний рахунок. `tierSize = null` — документного
 * пакета немає. Ціна складу = ціна пакета за `tierSize` (сітка у `.env`).
 */
@Schema({ _id: false })
class DocumentsWarehouse {
    @Prop({ type: Number, default: null })
    tierSize!: number | null;

    @Prop({ type: [Types.ObjectId], default: [] })
    attachedBusinessIds!: Types.ObjectId[];

    @Prop({ type: CreditAccount, default: () => ({}) })
    credits!: CreditAccount;

    /**
     * Відкладена зміна пакета: `null` — немає; `0` — прибрати документний
     * всесвіт на межі наступного циклу; `N>0` — знизити до пакета розміру N.
     * Діє з наступного циклу (поточний оплачено), без повернень.
     */
    @Prop({ type: Number, default: null })
    pendingTierSize!: number | null;

    /** Прикріплення, що лишаються в межах меншого пакета (див. Бренд-склад). */
    @Prop({ type: [Types.ObjectId], default: [] })
    pendingKeepBusinessIds!: Types.ObjectId[];
}

/**
 * Sprint 27 — білінговий профіль платника. Одна сутність на платника (unique
 * `userId`): день-якір циклу (з першої проплати), платіжний токен monobank, два
 * склади. Раз на місяць у день-якір billing-clock робить ОДНЕ списання: чиста
 * сума обох складів (`monthlyChargeAmount` від сітки). Ембеддед-білінг на
 * користувачі (Sprint 22) цю форму вже не вміщав — тому окрема колекція.
 *
 * `cardToken`/`walletId` — secret monobank-поля, НІКОЛИ не серіалізуються у
 * frontend (mapper віддає лише `BillingProfileViewSchema`). Клок-поля
 * (`nextChargeAt`, `dunning*`, `lastProviderEventAt`, `needsManualReview`) —
 * та сама самокерована механіка, що у Sprint 22, тепер на рівні профілю.
 */
@Schema({ timestamps: true })
export class BillingProfile {
    @Prop({ required: true, type: Types.ObjectId })
    userId!: Types.ObjectId;

    @Prop({ type: String, default: null })
    provider!: string | null;

    /** Secret-токен картки monobank — веде всі списання. Не у frontend. */
    @Prop({ type: String, default: null })
    cardToken!: string | null;

    /** Стабільний per-user гаманець monobank для токенізації. Не у frontend. */
    @Prop({ type: String, default: null })
    walletId!: string | null;

    @Prop({ type: String, default: null })
    cardMask!: string | null;

    @Prop({ type: String, default: null })
    currency!: string | null;

    /** SUBSCRIPTION_STATUS: ACTIVE / PAST_DUE / CANCELED / INCOMPLETE / UNPAID. */
    @Prop({ type: String, default: null })
    status!: string | null;

    /** Початок поточного циклу (день-якір цього місяця). База для пропорції. */
    @Prop({ type: Date, default: null })
    currentPeriodStart!: Date | null;

    /**
     * День місяця першої проплати (1–31). Наступну межу циклу НЕ можна виводити
     * з попередньої: після короткого місяця вона застрягла б на меншому дні
     * назавжди (31 січ → 28 лют → 28 бер). Межа рахується від цього якоря
     * (clamp до останнього дня місяця, потім повернення до якоря).
     */
    @Prop({ type: Number, default: null })
    anchorDay!: number | null;

    /** Кінець поточного циклу (наступний день-якір). */
    @Prop({ type: Date, default: null })
    currentPeriodEnd!: Date | null;

    /**
     * Дата наступного списання нашим billing-clock (вісь планувальника).
     * Активний профіль завжди має її в майбутньому; скасування / зняття доступу
     * прибирають (null = планувальник профіль не чіпає).
     */
    @Prop({ type: Date, default: null })
    nextChargeAt!: Date | null;

    @Prop({ type: Boolean, default: false })
    cancelAtPeriodEnd!: boolean;

    @Prop({ type: Date, default: null })
    lastProviderEventAt!: Date | null;

    /** Лічильник невдалих спроб списання у поточній прострочці (0 коли ACTIVE). */
    @Prop({ type: Number, default: 0 })
    dunningAttempts!: number;

    /** Час наступної повторної спроби dunning (null поза прострочкою). */
    @Prop({ type: Date, default: null })
    nextRetryAt!: Date | null;

    /**
     * Durable-прапор для ops: списання дало нерозв'язний результат. Планувальник
     * зупинено (`nextChargeAt=null`), доступ збережено; знімається автоматично,
     * щойно результат стає відомим (settle claim-запису success/decline — вебхук
     * або clock-звірка, `clearChargeUncertainty`), або руками ops, якщо
     * підтвердження так і не прийшло.
     */
    @Prop({ type: Boolean, default: false })
    needsManualReview!: boolean;

    /**
     * Durable-маркер незавершеної реконсиляції прикріплених бізнесів. Стемпиться
     * при флипі доступу; знімається `ReconciliationService` після повного
     * проходу; daily-sweep добиває стемпнутих.
     */
    @Prop({ type: Date, default: null })
    reconcileRequiredAt!: Date | null;

    /**
     * Бізнеси, відкріплені зі складів (застосоване відкладене зменшення,
     * гасіння профілю), чия реконсиляція ще не завершилась. Durable-двійник
     * `reconcileRequiredAt` для detached: маркер сам по собі веде sweep лише по
     * прикріплених, а відкріплений бізнес у складах уже відсутній — без цього
     * списку крах між флипом і реконсиляцією лишив би його з `brandedAt` (бренд
     * безкоштовно) назавжди. Пишеться АТОМАРНО з тримом прикріплень (та сама
     * TX/updateOne); чиститься разом зі зняттям маркера після повного проходу.
     */
    @Prop({ type: [Types.ObjectId], default: [] })
    pendingReconcileBusinessIds!: Types.ObjectId[];

    @Prop({ type: BrandWarehouse, default: () => ({}) })
    brand!: BrandWarehouse;

    @Prop({ type: DocumentsWarehouse, default: () => ({}) })
    documents!: DocumentsWarehouse;

    // Declared for TypeScript visibility; managed by Mongoose timestamps: true.
    createdAt!: Date;
    updatedAt!: Date;
}

export const BillingProfileSchema =
    SchemaFactory.createForClass(BillingProfile);

// Один профіль на платника.
BillingProfileSchema.index({ userId: 1 }, { unique: true });
// billing-clock: профілі з насталою датою списання / повтору.
BillingProfileSchema.index({ nextChargeAt: 1 }, { sparse: true });
BillingProfileSchema.index({ nextRetryAt: 1 }, { sparse: true });
// daily-sweep незавершених реконсиляцій.
BillingProfileSchema.index({ reconcileRequiredAt: 1 }, { sparse: true });
// Per-business гейтинг: «які профілі мають цей бізнес прикріпленим у складі».
// Multikey-індекс за масивом прикріплень кожного всесвіту — гаряча перевірка
// «чи бізнес у активному Бренд/Документному складі».
BillingProfileSchema.index({ 'brand.attachedBusinessIds': 1 });
BillingProfileSchema.index({ 'documents.attachedBusinessIds': 1 });
