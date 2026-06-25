import { z } from 'zod';

// --- Enums ---

export const PAYMENT_TYPE = {
    SUBSCRIPTION: 'subscription',
    ONE_OFF: 'one_off',
} as const;

export type PaymentType = (typeof PAYMENT_TYPE)[keyof typeof PAYMENT_TYPE];

// --- Plan/One-off Code Identifiers ---
// Structural identifiers used in DB records, i18n keys, image filenames.
// Adding a new plan requires: code here + entry у статичному каталозі нижче +
// i18n keys + image assets.

export const SUBSCRIPTION_PLAN_CODES = ['brand', 'bookkeeper'] as const;
export type SubscriptionPlanCode = (typeof SUBSCRIPTION_PLAN_CODES)[number];

// Коди дзеркалять рівні доступу (one-off = «купити рівень на місяць»). Збіг із
// `SUBSCRIPTION_PLAN_CODES` навмисний: продукти розрізняються `kind` у
// orderReference, не кодом. Без дефісів — order-reference сегментує по `-`.
export const ONE_OFF_ACCESS_CODES = ['brand', 'bookkeeper'] as const;
export type OneOffAccessCode = (typeof ONE_OFF_ACCESS_CODES)[number];

// --- Access level (єдине джерело істини рівня доступу) ---
// Впорядкований рівень none < brand < bookkeeper. Реальний рівень користувача
// обчислюється з білінг-стану як максимум активної підписки і активного one-off;
// усі замки питають «рівень не нижче потрібного». Підписка `brand`/`bookkeeper`
// дає однойменний рівень; one-off дзеркалить ті самі рівні з датою закінчення.

export const ACCESS_LEVELS = ['none', 'brand', 'bookkeeper'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

const ACCESS_LEVEL_RANK: Record<AccessLevel, number> = {
    none: 0,
    brand: 1,
    bookkeeper: 2,
};

export function isAccessLevelAtLeast(
    actual: AccessLevel,
    required: AccessLevel
): boolean {
    return ACCESS_LEVEL_RANK[actual] >= ACCESS_LEVEL_RANK[required];
}

export function maxAccessLevel(a: AccessLevel, b: AccessLevel): AccessLevel {
    return ACCESS_LEVEL_RANK[a] >= ACCESS_LEVEL_RANK[b] ? a : b;
}

// --- Billing-wide constants ---
// Один продукт = одна валюта (гривня). WayForPay multi-currency поза скоупом.
export const BILLING_CURRENCY = 'UAH';

export type BillingInterval = 'month' | 'year';

// --- Catalog Types (статичний конфіг, не runtime-fetch) ---

export interface SubscriptionPlanItem {
    code: SubscriptionPlanCode;
    name: string;
    priceAmount: number; // копійки
    currency: string;
    interval: BillingInterval;
    level: AccessLevel;
    displayOrder: number;
    featured: boolean;
}

export interface OneOffAccessItem {
    code: OneOffAccessCode;
    name: string;
    priceAmount: number; // копійки
    currency: string;
    level: AccessLevel;
    durationMonths: number;
    displayOrder: number;
    featured: boolean;
}

export interface PaymentsCatalog {
    subscriptionPlans: SubscriptionPlanItem[];
    oneOffAccesses: OneOffAccessItem[];
}

// --- Static Catalog (структура — джерело істини) ---
// Структура (коди, рівні, інтервал, назви) — джерело істини. `priceAmount` тут —
// лише ДЕФОЛТ (копійки: 49 грн = 4900); у рантаймі ціну накладає API з ENV
// (`CatalogService`, Sprint 22) — і на ендпоінт каталогу, і на суму списання.
// One-off за місяць дорожчий за місяць підписки (підштовхує до підписки).

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlanItem[] = [
    {
        code: 'brand',
        name: 'Бренд',
        priceAmount: 4900,
        currency: BILLING_CURRENCY,
        interval: 'month',
        level: 'brand',
        displayOrder: 0,
        featured: true,
    },
    {
        code: 'bookkeeper',
        name: 'Агенція',
        priceAmount: 9900,
        currency: BILLING_CURRENCY,
        interval: 'month',
        level: 'bookkeeper',
        displayOrder: 1,
        featured: false,
    },
] as const;

export const ONE_OFF_ACCESSES: readonly OneOffAccessItem[] = [
    {
        code: 'brand',
        name: 'Бренд на місяць',
        priceAmount: 6900,
        currency: BILLING_CURRENCY,
        level: 'brand',
        durationMonths: 1,
        displayOrder: 0,
        featured: true,
    },
    {
        code: 'bookkeeper',
        name: 'Агенція на місяць',
        priceAmount: 12_900,
        currency: BILLING_CURRENCY,
        level: 'bookkeeper',
        durationMonths: 1,
        displayOrder: 1,
        featured: false,
    },
] as const;

export const PAYMENTS_CATALOG: PaymentsCatalog = {
    subscriptionPlans: [...SUBSCRIPTION_PLANS],
    oneOffAccesses: [...ONE_OFF_ACCESSES],
};

export function findSubscriptionPlan(
    code: string
): SubscriptionPlanItem | undefined {
    return SUBSCRIPTION_PLANS.find((p) => p.code === code);
}

export function findOneOffAccess(code: string): OneOffAccessItem | undefined {
    return ONE_OFF_ACCESSES.find((p) => p.code === code);
}

/** Рівень підписки за кодом плану; 'none' для null/невідомого коду. */
export function levelOfSubscriptionPlan(
    code: string | null | undefined
): AccessLevel {
    if (!code) return 'none';
    return findSubscriptionPlan(code)?.level ?? 'none';
}

/** Рівень one-off доступу за кодом; 'none' для null/невідомого коду. */
export function levelOfOneOffAccess(
    code: string | null | undefined
): AccessLevel {
    if (!code) return 'none';
    return findOneOffAccess(code)?.level ?? 'none';
}

/**
 * Реальний рівень доступу користувача = максимум активної підписки і активного
 * one-off. Підписка зараховується при `hasActiveSubscription` (живий слот:
 * ACTIVE або прострочка в межах грейсу — доступ тримається, поки billing-clock
 * не вичерпав спроби). one-off зараховується поки `oneOffAccessUntil` у
 * майбутньому (гасне ліниво на read, без cron). Єдине джерело для API-замків і
 * web-гейтингу.
 */
export function deriveAccessLevel(
    billing: {
        planCode: string | null;
        hasActiveSubscription: boolean;
        subscriptionStatus: string | null;
        oneOffLevel: AccessLevel | null;
        oneOffAccessUntil: Date | null;
    } | null,
    now: Date
): AccessLevel {
    if (!billing) return 'none';
    const subLevel = billing.hasActiveSubscription
        ? levelOfSubscriptionPlan(billing.planCode)
        : 'none';
    const oneOffActive =
        billing.oneOffLevel != null &&
        billing.oneOffAccessUntil != null &&
        billing.oneOffAccessUntil.getTime() > now.getTime();
    const oneOffLevel = oneOffActive ? billing.oneOffLevel! : 'none';
    return maxAccessLevel(subLevel, oneOffLevel);
}

// --- Status & Event Enums ---

export const SUBSCRIPTION_STATUS = {
    /** Підписка активна, billing-clock спише її у `nextChargeAt`. */
    ACTIVE: 'ACTIVE',
    /** Списання продовження відхилено, доступ тримається на грейс-вікно dunning. */
    PAST_DUE: 'PAST_DUE',
    /** Скасована користувачем у кінці періоду або після вичерпання грейсу. */
    CANCELED: 'CANCELED',
    /** Checkout створено, перше списання ще не підтверджене. */
    INCOMPLETE: 'INCOMPLETE',
    /** Грейс dunning вичерпано без оплати — доступ знято. */
    UNPAID: 'UNPAID',
    UNKNOWN: 'UNKNOWN',
} as const;

export type SubscriptionStatus =
    (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

export const BILLING_EVENT_TYPE = {
    CHECKOUT_COMPLETED: 'CHECKOUT_COMPLETED',
    SUBSCRIPTION_UPDATED: 'SUBSCRIPTION_UPDATED',
    SUBSCRIPTION_DELETED: 'SUBSCRIPTION_DELETED',
    ONE_OFF_PAYMENT_COMPLETED: 'ONE_OFF_PAYMENT_COMPLETED',
} as const;

export type BillingEventType =
    (typeof BILLING_EVENT_TYPE)[keyof typeof BILLING_EVENT_TYPE];

// --- Payment Record (нова легка колекція платежів) ---
// Джерело історії грошових списань і refund. Наповнюється з вебхуків.

export const PAYMENT_RECORD_TYPE = {
    SUBSCRIPTION: 'subscription', // списання підписки (перше або продовження billing-clock)
    ONE_OFF: 'one_off', // разовий доступ на місяць
    // Success-списання, яке неможливо звести з чинним станом користувача
    // (наприклад, гроші пройшли, але підписку вже скасовано/перезаписано). Слід
    // для ручного розбору; окремий тип тримає його поза звичайною історією.
    UNMATCHED: 'unmatched',
} as const;

export type PaymentRecordType =
    (typeof PAYMENT_RECORD_TYPE)[keyof typeof PAYMENT_RECORD_TYPE];

export const PAYMENT_RECORD_STATUS = {
    PENDING: 'pending',
    APPROVED: 'approved',
    DECLINED: 'declined',
    REFUNDED: 'refunded',
} as const;

export type PaymentRecordStatus =
    (typeof PAYMENT_RECORD_STATUS)[keyof typeof PAYMENT_RECORD_STATUS];

/** Public shape списку списань у кабінеті (без provider-secret полів). */
export const PaymentRecordSchema = z.object({
    id: z.string(),
    type: z.enum([
        PAYMENT_RECORD_TYPE.SUBSCRIPTION,
        PAYMENT_RECORD_TYPE.ONE_OFF,
        PAYMENT_RECORD_TYPE.UNMATCHED,
    ]),
    amount: z.number().int(), // копійки
    currency: z.string(),
    status: z.enum([
        PAYMENT_RECORD_STATUS.PENDING,
        PAYMENT_RECORD_STATUS.APPROVED,
        PAYMENT_RECORD_STATUS.DECLINED,
        PAYMENT_RECORD_STATUS.REFUNDED,
    ]),
    cardMask: z.string().nullable(),
    refundAmount: z.number().int().nullable(),
    createdAt: z.coerce.date(),
});

export type PaymentRecord = z.infer<typeof PaymentRecordSchema>;

// --- Schemas ---

export const CreateCheckoutSessionSchema = z
    .object({
        paymentType: z.enum([PAYMENT_TYPE.SUBSCRIPTION, PAYMENT_TYPE.ONE_OFF]),
        planCode: z.string().min(1).optional(),
        oneOffCode: z.string().min(1).optional(),
        returnPath: z.string().startsWith('/').max(256).optional(),
    })
    .refine(
        (data) =>
            data.paymentType === PAYMENT_TYPE.SUBSCRIPTION
                ? !!data.planCode
                : !!data.oneOffCode,
        {
            message:
                'planCode required for subscription, oneOffCode required for one_off',
        }
    );

export type CreateCheckoutSession = z.infer<typeof CreateCheckoutSessionSchema>;

/**
 * Скасування — єдиний режим: у кінці періоду. Без поля `withRefund` (refund
 * прибрано зі скоупу MVP) і без зміни тарифу (через скасування + нове
 * оформлення). Тіла запиту немає.
 *
 * Відновлення під час прострочки («оплатити зараз») переоформлює checkout-флоу
 * підписки через `CreateCheckoutSessionSchema` (resume-ендпоінт), тож власної
 * схеми не потребує.
 */
export const ResumeSubscriptionSchema = z.object({
    returnPath: z.string().startsWith('/').max(256).optional(),
});

export type ResumeSubscription = z.infer<typeof ResumeSubscriptionSchema>;

/**
 * Public billing shape, що повертається у `getMe`. НЕ містить provider-secret
 * полів (`recToken`) і внутрішніх ordering-полів (`orderReference`,
 * `lastProviderEventAt`) — їх тримає лише Mongoose-субдок на боці API.
 */
export const UserBillingSchema = z.object({
    provider: z.string().nullable(),
    planCode: z.string().nullable(),
    currency: z.string().nullable(),
    subscriptionStatus: z
        .enum([
            SUBSCRIPTION_STATUS.ACTIVE,
            SUBSCRIPTION_STATUS.PAST_DUE,
            SUBSCRIPTION_STATUS.CANCELED,
            SUBSCRIPTION_STATUS.INCOMPLETE,
            SUBSCRIPTION_STATUS.UNPAID,
            SUBSCRIPTION_STATUS.UNKNOWN,
        ])
        .nullable(),
    currentPeriodEnd: z.coerce.date().nullable(),
    /**
     * Дата наступного списання нашим billing-clock (вісь планувальника). Активна
     * підписка завжди має її в майбутньому; скасування і зняття доступу прибирають.
     */
    nextChargeAt: z.coerce.date().nullable(),
    cancelAtPeriodEnd: z.boolean(),
    hasActiveSubscription: z.boolean(),
    cardMask: z.string().nullable(),
    /** Рівень активного one-off доступу + дата його закінчення. */
    oneOffLevel: z.enum(ACCESS_LEVELS).nullable(),
    oneOffAccessUntil: z.coerce.date().nullable(),
    /**
     * Похідний рівень доступу (max підписки і one-off) на момент відповіді.
     * Не зберігається — обчислюється `deriveAccessLevel` при серіалізації.
     */
    accessLevel: z.enum(ACCESS_LEVELS),
});

export type UserBilling = z.infer<typeof UserBillingSchema>;

/**
 * Статуси рахунку monobank «Плата» (`GET /api/merchant/invoice/status` і той
 * самий shape у вебхуку). `hold` не виникає при `paymentType: 'debit'`, але
 * лишається у переліку для повноти. Термінальні: success / failure / reversed /
 * expired; нетермінальні (проміжні): created / processing / hold.
 */
export const MONOBANK_INVOICE_STATUS = {
    CREATED: 'created',
    PROCESSING: 'processing',
    HOLD: 'hold',
    SUCCESS: 'success',
    FAILURE: 'failure',
    REVERSED: 'reversed',
    EXPIRED: 'expired',
} as const;

export type MonobankInvoiceStatus =
    (typeof MONOBANK_INVOICE_STATUS)[keyof typeof MONOBANK_INVOICE_STATUS];

/** Нетермінальні статуси: фінальний прийде окремою подією / запитом статусу. */
export const MONOBANK_NON_TERMINAL_STATUSES: readonly MonobankInvoiceStatus[] = [
    MONOBANK_INVOICE_STATUS.CREATED,
    MONOBANK_INVOICE_STATUS.PROCESSING,
    MONOBANK_INVOICE_STATUS.HOLD,
];

/**
 * Нормалізована подія списання monobank, яку провайдер віддає сервісу після
 * розбору і верифікації підпису вебхука АБО запиту статусу рахунку. Провайдер НЕ
 * класифікує семантику білінгу (підписка vs пакет) — це робить сервіс, декодуючи
 * `orderReference` (наш `reference`, проштовхнутий у `merchantPaymInfo`). Сюди
 * потрапляють лише факти транзакції.
 *
 * `amount` — копійки-integer (monobank оперує мінорними одиницями напряму).
 * `cardToken` — secret-токен картки, захоплений при першому хостованому checkout;
 * сервіс зберігає для продовжень, у frontend не віддає.
 */
export const BillingWebhookEventSchema = z.object({
    /**
     * Ключ дедуплікації: `${invoiceId}:${status}`. Один invoiceId проходить
     * кілька статус-переходів (processing → success), і кожен оброблюється
     * окремо, інакше фінальний success відкинувся б як дубль проміжного.
     */
    providerEventId: z.string(),
    /** Наш `reference` (маршрутизація вебхука: кому і що нарахувати). */
    orderReference: z.string(),
    /** monobank invoiceId — ключ для запиту статусу і звірки сумнівних списань. */
    invoiceId: z.string(),
    occurredAt: z.coerce.date(),
    /** Raw статус рахунку monobank: success / failure / processing / ... */
    status: z.string(),
    amount: z.number().int(), // копійки
    currency: z.string(),
    cardToken: z.string().nullable(),
    cardMask: z.string().nullable(),
    failureReason: z.string().nullable(),
    errCode: z.string().nullable(),
    raw: z.record(z.string(), z.unknown()),
});

export type BillingWebhookEvent = z.infer<typeof BillingWebhookEventSchema>;
