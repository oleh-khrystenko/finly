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

// --- Static Catalog (єдине джерело істини) ---
// Ціни у копійках: 49 грн = 4900. WayForPay оперує decimal-сумою у валюті —
// конверсію копійки↔decimal робить payload-mapper провайдера. One-off за місяць
// дорожчий за місяць підписки (підштовхує до підписки).

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
 * one-off. Підписка зараховується при `hasActiveSubscription`, АЛЕ не у статусі
 * `TRIALING`: trial прибрано, тож єдиний TRIALING — це відкладений старт поверх
 * one-off (підписка ще не списана). Під час defer доступ дає лише оплачений
 * one-off, не майбутній (можливо вищий) тариф підписки. one-off зараховується
 * поки `oneOffAccessUntil` у майбутньому (гасне ліниво на read, без cron). Єдине
 * джерело для API-замків і web-гейтингу.
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
    const subscriptionCounts =
        billing.hasActiveSubscription &&
        billing.subscriptionStatus !== SUBSCRIPTION_STATUS.TRIALING;
    const subLevel = subscriptionCounts
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
    ACTIVE: 'ACTIVE',
    TRIALING: 'TRIALING',
    PAST_DUE: 'PAST_DUE',
    CANCELED: 'CANCELED',
    INCOMPLETE: 'INCOMPLETE',
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
    SUBSCRIPTION: 'subscription', // рекурентне списання підписки
    ONE_OFF: 'one_off', // разовий доступ на місяць
    PRORATION: 'proration', // негайна доплата при апгрейді
    // Approved-списання на orderReference, що вже не є чинним для користувача
    // (рекурент пережив перезапис checkout-ом/re-bind-ом). Гроші рухались, але
    // грант неможливий — слід для ручного розбору. Окремий тип, щоб запис не
    // потрапляв у refund-скоуп cancel-у (він фільтрує type=subscription).
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
        PAYMENT_RECORD_TYPE.PRORATION,
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

export const CancelSubscriptionSchema = z.object({
    /**
     * true → скасування з поверненням за невикористаний період (refund +
     * REMOVE одразу). false → у кінці періоду (лишається активною до межі).
     */
    withRefund: z.boolean(),
});

export type CancelSubscription = z.infer<typeof CancelSubscriptionSchema>;

export const ChangePlanSchema = z.object({
    planCode: z.enum(SUBSCRIPTION_PLAN_CODES),
});

export type ChangePlan = z.infer<typeof ChangePlanSchema>;

export const UpdateCardSchema = z.object({
    returnPath: z.string().startsWith('/').max(256).optional(),
});

export type UpdateCard = z.infer<typeof UpdateCardSchema>;

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
            SUBSCRIPTION_STATUS.TRIALING,
            SUBSCRIPTION_STATUS.PAST_DUE,
            SUBSCRIPTION_STATUS.CANCELED,
            SUBSCRIPTION_STATUS.INCOMPLETE,
            SUBSCRIPTION_STATUS.UNPAID,
            SUBSCRIPTION_STATUS.UNKNOWN,
        ])
        .nullable(),
    currentPeriodEnd: z.coerce.date().nullable(),
    cancelAtPeriodEnd: z.boolean(),
    hasActiveSubscription: z.boolean(),
    scheduledPlanCode: z.string().nullable(),
    scheduledChangeDate: z.coerce.date().nullable(),
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
 * Нормалізована подія транзакції WayForPay, яку провайдер віддає сервісу після
 * розбору і верифікації підпису вебхука. Провайдер НЕ класифікує семантику
 * білінгу (підписка vs пакет vs proration) — це робить сервіс, декодуючи
 * `orderReference` і звіряючи з `billing.orderReference`. Сюди потрапляють лише
 * факти транзакції.
 *
 * `amount`/`refundAmount` — копійки-integer (конвертовані з WayForPay decimal
 * payload-mapper-ом). `recToken` — secret-токен картки, захоплений при
 * створенні підписки; сервіс зберігає, у frontend не віддає.
 */
export const WAYFORPAY_TRANSACTION_STATUS = {
    APPROVED: 'Approved',
    DECLINED: 'Declined',
    REFUNDED: 'Refunded',
    VOIDED: 'Voided',
    IN_PROCESSING: 'InProcessing',
    PENDING: 'Pending',
    EXPIRED: 'Expired',
} as const;

export type WayforpayTransactionStatus =
    (typeof WAYFORPAY_TRANSACTION_STATUS)[keyof typeof WAYFORPAY_TRANSACTION_STATUS];

export const BillingWebhookEventSchema = z.object({
    /**
     * Ключ дедуплікації. `txn:${transactionId}:${transactionStatus}` —
     * per-transaction id WayForPay плюс статус: один transactionId проходить
     * кілька статус-переходів (InProcessing → Approved), і кожен має оброблятись
     * окремо, інакше фінальний Approved відкинувся б як дубль проміжного
     * колбеку. Fallback `${orderReference}:${transactionStatus}:${processingDate}`
     * лише для рідких колбеків без transactionId.
     */
    providerEventId: z.string(),
    orderReference: z.string(),
    occurredAt: z.coerce.date(),
    /** Raw lifecycle WayForPay: Approved / Declined / Refunded / ... */
    transactionStatus: z.string(),
    amount: z.number().int(), // копійки
    currency: z.string(),
    transactionId: z.string().nullable(),
    cardMask: z.string().nullable(),
    recToken: z.string().nullable(),
    reasonCode: z.number().nullable(),
    raw: z.record(z.string(), z.unknown()),
});

export type BillingWebhookEvent = z.infer<typeof BillingWebhookEventSchema>;
