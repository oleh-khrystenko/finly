import { z } from 'zod';

// --- Enums ---

export const PAYMENT_TYPE = {
    SUBSCRIPTION: 'subscription',
    ONE_OFF: 'one_off',
} as const;

export type PaymentType = (typeof PAYMENT_TYPE)[keyof typeof PAYMENT_TYPE];

// --- Plan/Pack Code Identifiers ---
// Structural identifiers used in DB records, i18n keys, image filenames.
// Adding a new plan requires: code here + i18n keys + image assets + Stripe Product.

export const SUBSCRIPTION_PLAN_CODES = ['starter', 'pro'] as const;
export type SubscriptionPlanCode = (typeof SUBSCRIPTION_PLAN_CODES)[number];

export const EXECUTION_PACK_CODES = ['basic', 'max'] as const;
export type ExecutionPackCode = (typeof EXECUTION_PACK_CODES)[number];

// --- Catalog Types (fetched from Stripe at runtime) ---

export interface SubscriptionPlanItem {
    code: string;
    priceId: string;
    priceAmount: number; // cents
    currency: string;
    interval: string; // 'month' | 'year'
    executions: number;
    displayOrder: number;
    featured: boolean;
}

export interface ExecutionPackItem {
    code: string;
    priceId: string;
    priceAmount: number; // cents
    currency: string;
    executions: number;
    displayOrder: number;
    featured: boolean;
}

export interface PaymentsCatalog {
    subscriptionPlans: SubscriptionPlanItem[];
    executionPacks: ExecutionPackItem[];
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

export const UserBillingSchema = z.object({
    provider: z.string().nullable(),
    providerCustomerId: z.string().nullable(),
    providerSubscriptionId: z.string().nullable(),
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
    providerSubscriptionStatus: z.string().nullable(),
    currentPeriodEnd: z.coerce.date().nullable(),
    cancelAtPeriodEnd: z.boolean(),
    hasActiveSubscription: z.boolean(),
    lastProviderEventAt: z.coerce.date().nullable(),
    scheduledPlanCode: z.string().nullable(),
    scheduledChangeDate: z.coerce.date().nullable(),
});

export type UserBilling = z.infer<typeof UserBillingSchema>;

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
