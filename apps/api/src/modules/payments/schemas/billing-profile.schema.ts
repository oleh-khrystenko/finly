import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
    CARD_VERIFICATION_STATUS,
    type CardPaymentMethod,
    type CardVerificationStatus,
} from '@finly/types';

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
 * Документний склад без кредитного рахунку — рівно те, що описує ЦІНУ і
 * прикріплення всесвіту. Форма знімка вимкненого профілю
 * (див. `DisabledComposition`): кредити живі й поверненням не відкочуються, тож
 * у знімку їм місця немає.
 */
@Schema({ _id: false })
class DisabledDocumentsWarehouse {
    @Prop({ type: Number, default: null })
    tierSize!: number | null;

    @Prop({ type: [Types.ObjectId], default: [] })
    attachedBusinessIds!: Types.ObjectId[];

    @Prop({ type: Number, default: null })
    pendingTierSize!: number | null;

    @Prop({ type: [Types.ObjectId], default: [] })
    pendingKeepBusinessIds!: Types.ObjectId[];
}

/**
 * Sprint 43 — склад підписки на момент, коли доступ вимкнено вичерпаною
 * прострочкою: обидві ємності разом з відкладеними зменшеннями і
 * прикріпленнями.
 *
 * Живі поля складу для цього не годяться, бо в них ДВА різні значення: у
 * живого профілю це «за що платник платить», а у профілю без доступу
 * `startCheckout` перезаписує їх бажаним складом нової купівлі. Покинута нова
 * купівля (платник відкрив сторінку банку і закрив її) інакше тихо зменшувала
 * б суму повернення збереженою карткою і губила прикріплення, за які вже
 * заплачено.
 */
@Schema({ _id: false })
class DisabledComposition {
    @Prop({ type: BrandWarehouse, required: true })
    brand!: BrandWarehouse;

    @Prop({ type: DisabledDocumentsWarehouse, required: true })
    documents!: DisabledDocumentsWarehouse;
}

/**
 * Sprint 43 — остання спроба прив'язки картки. Платник повертається зі сторінки
 * банку раніше, ніж гарантовано приходить сповіщення, тож результат для нього
 * дозвіряється запитом статусу рахунку за `invoiceId`. Нова спроба перезаписує
 * попередню: кабінет питає лише про ту, з якої платник щойно повернувся.
 */
@Schema({ _id: false })
class CardVerificationAttempt {
    @Prop({ required: true })
    orderReference!: string;

    @Prop({ required: true })
    invoiceId!: string;

    @Prop({ required: true, enum: Object.values(CARD_VERIFICATION_STATUS) })
    status!: CardVerificationStatus;
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

    /**
     * Sprint 43 — токени карток, які профіль уже забув, але гаманець провайдера
     * ще тримає. Токен потрапляє сюди тим самим записом, що стирає його з
     * `cardToken`, і зникає лише після підтвердженого відкликання у банку.
     * Без черги збій одного запиту до банку губив би єдиний запис токена, і
     * картка лишалась би в гаманці назавжди. Не у frontend.
     */
    @Prop({ type: [String], default: [] })
    pendingRevokeCardTokens!: string[];

    /**
     * Sprint 43 — скільки разів поспіль банк не прийняв відкликання токена з
     * черги. Успішне відкликання обнуляє лічильник; на межі
     * `BILLING_CARD_REVOCATION_MAX_FAILURES` черга здається (токен виходить з
     * неї, ops отримує лист). Без цієї межі застряглий токен тримав би профіль
     * живим безстроково, а з ним — і остаточне видалення акаунта.
     */
    @Prop({ type: Number, default: 0 })
    cardRevocationFailures!: number;

    /**
     * Sprint 43 — з якого моменту є здане відкликання картки, про яке ще не
     * надіслано лист на `OPS_ALERT_EMAIL`. Ставиться тим самим записом, що
     * виводить токен з черги, знімається фоновою відправкою після успішного
     * листа. Після відступу токена в профілі вже немає, тож ця мітка —
     * єдиний слід картки, що лишилась у гаманці monobank: збій пошти без неї
     * загубив би картку назавжди.
     */
    @Prop({ type: Date, default: null })
    cardRevocationAlertDueAt!: Date | null;

    /** Стабільний per-user гаманець monobank для токенізації. Не у frontend. */
    @Prop({ type: String, default: null })
    walletId!: string | null;

    @Prop({ type: String, default: null })
    cardMask!: string | null;

    /**
     * Спосіб оплати з `paymentInfo.paymentMethod`. Фіксується РІВНО на checkout —
     * там, де платник прив'язує картку. Циклові списання йдуть збереженим токеном
     * і завжди повертають `wallet`, тобто перезапис звідти стер би знання про те,
     * чим картку прив'язували, і кабінет після першого ж продовження почав би
     * показувати цифри підставного номера як справжні (`hasRealCardNumber`).
     */
    @Prop({ type: String, default: null })
    cardPaymentMethod!: CardPaymentMethod | null;

    @Prop({ type: String, default: null })
    cardPaymentSystem!: string | null;

    @Prop({ type: String, default: null })
    cardBank!: string | null;

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
     * Sprint 43 — з якого моменту є ручний розбір, про який ще не надіслано
     * лист на `OPS_ALERT_EMAIL`. Ставиться разом з `needsManualReview`,
     * знімається фоновою відправкою після успішного листа. Окреме від прапорця
     * поле, бо лист не можна слати з транзакції, у якій ставиться прапорець:
     * її повтор надіслав би лист двічі, а відкат — про гроші, яких немає.
     */
    @Prop({ type: Date, default: null })
    manualReviewAlertDueAt!: Date | null;

    /**
     * Sprint 31 — пауза планувальника на час вікна відновлення акаунта.
     * Ставиться при підтвердженні видалення, знімається при відновленні,
     * зникає разом з профілем при остаточному прибиранні.
     *
     * Поки стоїть, billing-clock не бере профіль ні у чергове списання, ні у
     * повторну спробу по боргу (перекриті обидві доріжки). Жодне інше поле
     * білінгу підтвердження не чіпає: картка, межі оплаченого періоду, статус і
     * склад прикріплень лишаються недоторканими, тож відновлення повертає
     * людину рівно у той стан, у якому вона була.
     *
     * Наявне `cancelAtPeriodEnd` для цього не годиться: воно стирає збережену
     * картку, а на межі періоду гасить платника (штампи `brandedAt` знімаються,
     * кастомні slug-и йдуть у slug-rent) — і зворотної дії до нього немає.
     */
    @Prop({ type: Date, default: null })
    billingPausedAt!: Date | null;

    /**
     * Sprint 43 — момент, коли доступ вимкнено вичерпаною прострочкою. Точка
     * відліку строку зберігання картки: списання не пройшло жодного разу, але
     * рішення піти платник не приймав, тож картка лишається ще на строк з
     * `BILLING_CARD_RETENTION_DAYS` і повернення коштує один клік.
     *
     * Вивести момент з наявних полів не можна: `currentPeriodEnd` показує межу
     * оплаченого періоду, а не дату вимкнення, і між ними лежить усе вікно
     * прострочки.
     *
     * Живе рівно стільки, скільки живе сам стан: скидається на успішній оплаті
     * (профіль ожив) і на остаточному згасанні профілю. Стирання картки мітку
     * НЕ чіпає — інакше картка, вписана після того стирання, не мала б від чого
     * відраховувати власний строк і лишилась би в гаманці банку назавжди.
     */
    @Prop({ type: Date, default: null })
    dunningExhaustedAt!: Date | null;

    /**
     * Sprint 43 — момент останньої успішної прив'язки картки перевіркою без
     * списання. Друга точка відліку строку зберігання: картка, яку платник
     * вписав уже після вимкнення доступу, отримує власний строк, а не зникає
     * наступної ночі за відліком від самого вимкнення.
     */
    @Prop({ type: Date, default: null })
    cardVerifiedAt!: Date | null;

    /**
     * Sprint 43 — склад, яким підписка жила на момент вимкнення доступу. Джерело
     * правди і для суми повернення збереженою карткою, і для того, який склад
     * це повернення відновлює (див. `DisabledComposition`). `null` — знімка
     * немає: профіль живий, або його вимкнули ще до появи поля, і тоді
     * повернення читає живі поля складу, як і раніше.
     */
    @Prop({ type: DisabledComposition, default: null })
    disabledSnapshot!: DisabledComposition | null;

    @Prop({ type: CardVerificationAttempt, default: null })
    cardVerification!: CardVerificationAttempt | null;

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
// Sprint 31 — компенсаційний прохід (`CleanupService.resyncRestoredAccounts`)
// шукає паузу, що пережила відновлення акаунта. Partial, а не sparse: дефолт
// поля — `null`, тобто значення присутнє, і sparse тримав би кожен профіль.
BillingProfileSchema.index(
    { billingPausedAt: 1 },
    { partialFilterExpression: { billingPausedAt: { $type: 'date' } } }
);
// Sprint 43 — гілка «покинута нова купівля поверх вимкненого доступу» у вибірці
// стирання карток за строком зберігання: статус там INCOMPLETE, і від решти
// незавершених купівель такий профіль відрізняє саме мітка вимкнення. Partial,
// а не sparse: дефолт поля — `null`, тобто значення присутнє, і sparse тримав
// би кожен профіль.
BillingProfileSchema.index(
    { dunningExhaustedAt: 1 },
    { partialFilterExpression: { dunningExhaustedAt: { $type: 'date' } } }
);
// Sprint 43 — повторюване стирання карток погашених профілів: картка, яку не
// вдалось стерти в годину згасання, підбирається наступним проходом.
BillingProfileSchema.index(
    { status: 1 },
    { partialFilterExpression: { cardToken: { $type: 'string' } } }
);
// Sprint 43 — повтор відкликань карток, які банк ще не прийняв. Partial: черга
// порожня майже в кожного профілю, і тримати їх в індексі нема для чого.
BillingProfileSchema.index(
    { pendingRevokeCardTokens: 1 },
    {
        partialFilterExpression: {
            pendingRevokeCardTokens: { $type: 'string' },
        },
    }
);
// Sprint 43 — фонова відправка листів про ручний розбір.
BillingProfileSchema.index(
    { manualReviewAlertDueAt: 1 },
    { partialFilterExpression: { manualReviewAlertDueAt: { $type: 'date' } } }
);
// Sprint 43 — фонова відправка листів про здане відкликання картки.
BillingProfileSchema.index(
    { cardRevocationAlertDueAt: 1 },
    {
        partialFilterExpression: {
            cardRevocationAlertDueAt: { $type: 'date' },
        },
    }
);
// Per-business гейтинг: «які профілі мають цей бізнес прикріпленим у складі».
// Multikey-індекс за масивом прикріплень кожного всесвіту — гаряча перевірка
// «чи бізнес у активному Бренд/Документному складі».
BillingProfileSchema.index({ 'brand.attachedBusinessIds': 1 });
BillingProfileSchema.index({ 'documents.attachedBusinessIds': 1 });
