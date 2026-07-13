import { z } from 'zod';
import { SUBSCRIPTION_STATUS } from './payments';
import { BILLING_UNIVERSE, creditPackSchema } from './billing-grid';
import { objectIdSchema } from '../validation/common';

/**
 * Sprint 27 — білінговий профіль платника як окрема сутність (не поле
 * користувача). Один профіль на платника: день-якір циклу, платіжний токен,
 * два склади (Бренд + Документи) з кредитним рахунком. Тут — СПІЛЬНІ enum-и і
 * публічні (без секретів) view-shape для кабінету; Mongoose-схема живе на боці
 * API.
 */

// ── Credit ledger ────────────────────────────────────────────────────────────

/**
 * Тип операції у книзі кредитів (append-only). `TOP_UP` — місячне доганяння до
 * обсягу пакета (top-up-to-cap); `PURCHASE` — докупівля прихованим пакетом;
 * `PROCESSING` — списання за AI-обробку (майбутній спринт конвеєра);
 * `STORAGE_RENT` — місячна рента за ГБ понад базу (майбутній спринт сховища).
 * Останні два вже у переліку, щоб книга вела їх з першого дня, коли з'являться.
 */
export const CREDIT_LEDGER_ENTRY_TYPE = {
    TOP_UP: 'top_up',
    PURCHASE: 'purchase',
    PROCESSING: 'processing',
    STORAGE_RENT: 'storage_rent',
} as const;

export type CreditLedgerEntryType =
    (typeof CREDIT_LEDGER_ENTRY_TYPE)[keyof typeof CREDIT_LEDGER_ENTRY_TYPE];

/** Публічний рядок книги операцій у кабінеті. */
export const CreditLedgerEntrySchema = z.object({
    id: z.string(),
    type: z.enum([
        CREDIT_LEDGER_ENTRY_TYPE.TOP_UP,
        CREDIT_LEDGER_ENTRY_TYPE.PURCHASE,
        CREDIT_LEDGER_ENTRY_TYPE.PROCESSING,
        CREDIT_LEDGER_ENTRY_TYPE.STORAGE_RENT,
    ]),
    /** Знакова зміна балансу: нарахування додатне, списання від'ємне. */
    credits: z.number().int(),
    balanceAfter: z.number().int(),
    createdAt: z.coerce.date(),
});

export type CreditLedgerEntry = z.infer<typeof CreditLedgerEntrySchema>;

// ── Billing profile (public view) ────────────────────────────────────────────

/** Публічний стан кредитного рахунку документного всесвіту. */
export const CreditAccountViewSchema = z.object({
    balance: z.number().int().nonnegative(),
    storageBytesUsed: z.number().int().nonnegative(),
});
export type CreditAccountView = z.infer<typeof CreditAccountViewSchema>;

/** Публічний стан складу «Бренд». */
export const BrandWarehouseViewSchema = z.object({
    capacity: z.number().int().nonnegative(),
    /**
     * Заплановане зменшення ємності: `null` — немає; число ≥0 — стільки слотів
     * лишиться з наступного циклу (`0` — всесвіт вимкнеться). Кабінет показує
     * це і дає скасувати (повторний виклик зміни ємності з поточним значенням).
     */
    pendingCapacity: z.number().int().nonnegative().nullable(),
    attachedBusinessIds: z.array(z.string()),
});
export type BrandWarehouseView = z.infer<typeof BrandWarehouseViewSchema>;

/** Публічний стан складу «Документи». */
export const DocumentsWarehouseViewSchema = z.object({
    tierSize: z.number().int().positive().nullable(),
    /** Заплановане зменшення пакета: `null` — немає; `0` — вимкнути всесвіт. */
    pendingTierSize: z.number().int().nonnegative().nullable(),
    attachedBusinessIds: z.array(z.string()),
    credits: CreditAccountViewSchema,
    /**
     * Приховані пакети докупівлі кредитів (з сітки). Живуть у профілі, не у
     * публічному каталозі: показуються контекстно на порогах балансу і лише
     * автентифікованому платнику. Єдине легітимне джерело для запиту
     * `BuyCredits` (запит несе значення пакета, звірене з цим списком).
     */
    creditPacks: z.array(creditPackSchema),
});
export type DocumentsWarehouseView = z.infer<
    typeof DocumentsWarehouseViewSchema
>;

/**
 * Публічний shape білінг-профілю у `getMe`. БЕЗ provider-secret полів
 * (`cardToken`, `walletId`) і internal-ordering (`lastProviderEventAt`,
 * `reconcileRequiredAt`).
 */
export const BillingProfileViewSchema = z.object({
    status: z
        .enum([
            SUBSCRIPTION_STATUS.ACTIVE,
            SUBSCRIPTION_STATUS.PAST_DUE,
            SUBSCRIPTION_STATUS.CANCELED,
            SUBSCRIPTION_STATUS.INCOMPLETE,
            SUBSCRIPTION_STATUS.UNPAID,
            SUBSCRIPTION_STATUS.UNKNOWN,
        ])
        .nullable(),
    currency: z.string().nullable(),
    currentPeriodEnd: z.coerce.date().nullable(),
    nextChargeAt: z.coerce.date().nullable(),
    cancelAtPeriodEnd: z.boolean(),
    cardMask: z.string().nullable(),
    /** Розрахункова сума наступного місячного списання, копійки. */
    nextChargeAmount: z.number().int().nonnegative(),
    brand: BrandWarehouseViewSchema,
    documents: DocumentsWarehouseViewSchema,
});

export type BillingProfileView = z.infer<typeof BillingProfileViewSchema>;

// ── Public catalog v2 (два всесвіти з сітки) ─────────────────────────────────

/**
 * Всесвіт «Бренд» у каталозі. `enabled` — чи продається зараз (Бренд вмикається
 * одразу; Документи можуть бути під конфіг-прапором «скоро»).
 */
export const CatalogBrandSchema = z.object({
    enabled: z.boolean(),
    pricePerBusiness: z.number().int().nonnegative(), // копійки
});

/** Пакет документів у каталозі (з похідним `storageGb` для UI). */
export const CatalogDocumentsTierSchema = z.object({
    size: z.number().int().positive(),
    priceAmount: z.number().int().nonnegative(),
    monthlyCredits: z.number().int().positive(),
    storageGb: z.number().int().positive(),
});

export const CatalogDocumentsSchema = z.object({
    enabled: z.boolean(),
    tiers: z.array(CatalogDocumentsTierSchema),
    storageGbPerBusiness: z.number().int().positive(),
    storageRentCreditsPerGb: z.number().int().nonnegative(),
    lowBalanceThreshold: z.number().int().nonnegative(),
    criticalBalanceThreshold: z.number().int().nonnegative(),
});

/**
 * Публічний каталог. Приховані пакети докупівлі кредитів сюди НЕ входять —
 * вони не продаються публічно, а з'являються контекстно на порогах балансу.
 */
export const BillingCatalogSchema = z.object({
    currency: z.string(),
    brand: CatalogBrandSchema,
    documents: CatalogDocumentsSchema,
});

export type BillingCatalog = z.infer<typeof BillingCatalogSchema>;

// ── Cabinet requests ─────────────────────────────────────────────────────────

const universeSchema = z.enum([
    BILLING_UNIVERSE.BRAND,
    BILLING_UNIVERSE.DOCUMENTS,
]);

const returnPathSchema = z.string().startsWith('/').max(256).optional();

/**
 * Перша купівля платника (немає збереженої картки): хостований checkout monobank
 * захоплює токен і ставить день-якір. Бренд задає початкову `capacity` (кількість
 * поштучних слотів), Документи — `tierSize` (розмір пакета). `attachBusinessId` —
 * бізнес, який одразу заповнює слот на успіху оплати (slug-upsell точки).
 */
export const StartCheckoutSchema = z
    .object({
        universe: universeSchema,
        capacity: z.number().int().positive().optional(),
        tierSize: z.number().int().positive().optional(),
        attachBusinessId: objectIdSchema.optional(),
        returnPath: returnPathSchema,
    })
    .refine(
        (d) =>
            d.universe === BILLING_UNIVERSE.BRAND
                ? d.capacity != null
                : d.tierSize != null,
        {
            message:
                'capacity required for brand, tierSize required for documents',
        }
    );
export type StartCheckout = z.infer<typeof StartCheckoutSchema>;

/**
 * Зміна ємності складу на наявному профілі (є токен). Збільшення — негайна
 * пропорційна доплата за токеном. Зменшення — з наступного циклу; `keepBusinessIds`
 * фіксує, які прикріплення лишаються в межах нової (меншої) ємності. `capacity`
 * для Бренду, `tierSize` для Документів; `0` для Бренду / відсутній `tierSize`
 * означає «прибрати всесвіт». Виклик з ПОТОЧНОЮ ємністю скасовує заплановане
 * зменшення (якщо воно є). `attachBusinessId` — бізнес, що атомарно заповнює
 * новий слот на успіху доплати (лише при збільшенні): одна оплата — один ефект,
 * без другого запиту, який міг би загубитись.
 */
export const ChangeCapacitySchema = z.object({
    universe: universeSchema,
    capacity: z.number().int().nonnegative().optional(),
    tierSize: z.number().int().positive().nullable().optional(),
    keepBusinessIds: z.array(objectIdSchema).optional(),
    attachBusinessId: objectIdSchema.optional(),
});
export type ChangeCapacity = z.infer<typeof ChangeCapacitySchema>;

/** Прикріплення / відкріплення бізнесу у межах ємності (без списань). */
export const ManageAttachmentSchema = z.object({
    universe: universeSchema,
    businessId: objectIdSchema,
});
export type ManageAttachment = z.infer<typeof ManageAttachmentSchema>;

/**
 * Докупівля прихованого пакета кредитів (негайне списання за токеном).
 * Пакет ідентифікується ЗНАЧЕННЯМ (`credits` + `priceAmount`), не індексом у
 * env-масиві: запит несе очікувану ціну, тож зміна `BILLING_DOC_CREDIT_PACKS`
 * між показом і покупкою дає 400 `INVALID_CREDIT_PACK` замість списання іншої
 * суми (та сама amount-звірка, що на активації checkout).
 */
export const BuyCreditsSchema = z.object({
    credits: z.number().int().positive(),
    /** Очікувана ціна пакета, копійки. */
    priceAmount: z.number().int().positive(),
});
export type BuyCredits = z.infer<typeof BuyCreditsSchema>;

/** Відновлення під час прострочки («оплатити зараз»): переоформлює checkout. */
export const ResumeSubscriptionSchema = z.object({
    returnPath: returnPathSchema,
});
export type ResumeSubscription = z.infer<typeof ResumeSubscriptionSchema>;

/** Запит калькулятора ціни для UI (жива ціна при зміні ємності). */
export const PriceCalculatorSchema = z.object({
    universe: universeSchema,
    capacity: z.number().int().nonnegative().optional(),
    tierSize: z.number().int().positive().nullable().optional(),
});
export type PriceCalculatorQuery = z.infer<typeof PriceCalculatorSchema>;

/**
 * Результат калькулятора: поточне і нове місячне списання, сума негайної доплати
 * (0 при зменшенні), і опційна підказка вигіднішого пакета.
 */
export const PriceCalculationSchema = z.object({
    currentMonthlyAmount: z.number().int().nonnegative(),
    newMonthlyAmount: z.number().int().nonnegative(),
    immediateCharge: z.number().int().nonnegative(),
    cheaperTierSize: z.number().int().positive().nullable(),
});
export type PriceCalculation = z.infer<typeof PriceCalculationSchema>;
