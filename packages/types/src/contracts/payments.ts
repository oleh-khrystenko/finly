import { z } from 'zod';

// --- Enums ---

export const PAYMENT_TYPE = {
    SUBSCRIPTION: 'subscription',
    ONE_OFF: 'one_off',
} as const;

export type PaymentType = (typeof PAYMENT_TYPE)[keyof typeof PAYMENT_TYPE];

// --- Plan/Pack Code Identifiers ---
// Structural identifiers used in DB records, i18n keys, image filenames.
// Adding a new plan requires: code here + entry у статичному каталозі нижче +
// i18n keys + image assets.

export const SUBSCRIPTION_PLAN_CODES = ['starter', 'pro'] as const;
export type SubscriptionPlanCode = (typeof SUBSCRIPTION_PLAN_CODES)[number];

export const EXECUTION_PACK_CODES = ['basic', 'max'] as const;
export type ExecutionPackCode = (typeof EXECUTION_PACK_CODES)[number];

// --- Billing-wide constants ---
// Один продукт = одна валюта (гривня). WayForPay multi-currency поза скоупом.
export const BILLING_CURRENCY = 'UAH';

// Безкоштовний пробний місяць: підписка створюється з відкладеним першим
// списанням (dateBegin = now + N місяців), стан TRIALING до першого успіху.
export const SUBSCRIPTION_TRIAL_MONTHS = 1;

export type BillingInterval = 'month' | 'year';

// --- Catalog Types (статичний конфіг, не runtime-fetch) ---

export interface SubscriptionPlanItem {
    code: SubscriptionPlanCode;
    priceAmount: number; // копійки
    currency: string;
    interval: BillingInterval;
    executions: number;
    displayOrder: number;
    featured: boolean;
}

export interface ExecutionPackItem {
    code: ExecutionPackCode;
    priceAmount: number; // копійки
    currency: string;
    executions: number;
    displayOrder: number;
    featured: boolean;
}

export interface PaymentsCatalog {
    subscriptionPlans: SubscriptionPlanItem[];
    executionPacks: ExecutionPackItem[];
}

// --- Static Catalog (єдине джерело істини) ---
// Ціни у копійках: 49 грн = 4900. WayForPay оперує decimal-сумою у валюті —
// конверсію копійки↔decimal робить payload-mapper провайдера.

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlanItem[] = [
    {
        code: 'starter',
        priceAmount: 4900,
        currency: BILLING_CURRENCY,
        interval: 'month',
        executions: 10_000,
        displayOrder: 0,
        featured: false,
    },
    {
        code: 'pro',
        priceAmount: 14_900,
        currency: BILLING_CURRENCY,
        interval: 'month',
        executions: 50_000,
        displayOrder: 1,
        featured: true,
    },
] as const;

export const EXECUTION_PACKS: readonly ExecutionPackItem[] = [
    {
        code: 'basic',
        priceAmount: 2900,
        currency: BILLING_CURRENCY,
        executions: 5_000,
        displayOrder: 0,
        featured: false,
    },
    {
        code: 'max',
        priceAmount: 9900,
        currency: BILLING_CURRENCY,
        executions: 18_000,
        displayOrder: 1,
        featured: true,
    },
] as const;

export const PAYMENTS_CATALOG: PaymentsCatalog = {
    subscriptionPlans: [...SUBSCRIPTION_PLANS],
    executionPacks: [...EXECUTION_PACKS],
};

export function findSubscriptionPlan(
    code: string
): SubscriptionPlanItem | undefined {
    return SUBSCRIPTION_PLANS.find((p) => p.code === code);
}

export function findExecutionPack(
    code: string
): ExecutionPackItem | undefined {
    return EXECUTION_PACKS.find((p) => p.code === code);
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
    PACK: 'pack', // разовий пакет executions
    PRORATION: 'proration', // негайна доплата при апгрейді
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
        PAYMENT_RECORD_TYPE.PACK,
        PAYMENT_RECORD_TYPE.PRORATION,
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
        packCode: z.string().min(1).optional(),
        returnPath: z.string().startsWith('/').max(256).optional(),
    })
    .refine(
        (data) =>
            data.paymentType === PAYMENT_TYPE.SUBSCRIPTION
                ? !!data.planCode
                : !!data.packCode,
        {
            message:
                'planCode required for subscription, packCode required for one_off',
        }
    );

export type CreateCheckoutSession = z.infer<typeof CreateCheckoutSessionSchema>;

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
});

export type UserBilling = z.infer<typeof UserBillingSchema>;

/**
 * Нормалізована подія білінгу, яку провайдер віддає сервісу після розбору
 * вебхука WayForPay. Reshape під WayForPay (orderReference замість Stripe
 * subscription-id, recToken/cardMask захоплення) — Блок 2.
 */
export const BillingWebhookEventSchema = z.object({
    type: z.enum([
        BILLING_EVENT_TYPE.CHECKOUT_COMPLETED,
        BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
        BILLING_EVENT_TYPE.SUBSCRIPTION_DELETED,
        BILLING_EVENT_TYPE.ONE_OFF_PAYMENT_COMPLETED,
    ]),
    providerEventId: z.string(),
    occurredAt: z.coerce.date(),
    userId: z.string(),
    // --- Subscription fields (присутні тільки для subscription events) ---
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
        .nullable()
        .optional(),
    currentPeriodStart: z.coerce.date().nullable().optional(),
    currentPeriodEnd: z.coerce.date().nullable().optional(),
    cancelAtPeriodEnd: z.boolean().optional(),
    previousPriceId: z.string().nullable().optional(),
    scheduledPlanCode: z.string().nullable().optional(),
    scheduledChangeDate: z.coerce.date().nullable().optional(),
    // --- One-off fields (присутні тільки для ONE_OFF_PAYMENT_COMPLETED) ---
    executionsAmount: z.number().int().positive().optional(),
    packCode: z.string().optional(),
    raw: z.record(z.string(), z.unknown()),
});

export type BillingWebhookEvent = z.infer<typeof BillingWebhookEventSchema>;
