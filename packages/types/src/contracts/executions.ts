import { z } from 'zod';

// --- Action Identifiers ---

export const EXECUTION_ACTION = {
    // Debit (user-initiated)
    STANDARD_REPORT: 'standard_report',
    AI_ANALYSIS: 'ai_analysis',
    DEEP_ANALYSIS: 'deep_analysis',
    FULL_AUDIT: 'full_audit',
    // Credit (system, via webhooks)
    SUBSCRIPTION_ACTIVATION: 'subscription_activation',
    PACK_PURCHASE: 'pack_purchase',
    PLAN_CHANGE: 'plan_change',
    // System
    BILLING_RESET: 'billing_reset',
} as const;

export type ExecutionAction =
    (typeof EXECUTION_ACTION)[keyof typeof EXECUTION_ACTION];

// --- Transaction Types ---

export const EXECUTION_TRANSACTION_TYPE = {
    CREDIT: 'credit',
    DEBIT: 'debit',
} as const;

export type ExecutionTransactionType =
    (typeof EXECUTION_TRANSACTION_TYPE)[keyof typeof EXECUTION_TRANSACTION_TYPE];

// --- Spendable Actions & Costs ---

export const SPENDABLE_ACTIONS = [
    EXECUTION_ACTION.STANDARD_REPORT,
    EXECUTION_ACTION.AI_ANALYSIS,
    EXECUTION_ACTION.DEEP_ANALYSIS,
    EXECUTION_ACTION.FULL_AUDIT,
] as const;

export type SpendableAction = (typeof SPENDABLE_ACTIONS)[number];

export const EXECUTION_ACTION_COST: Record<SpendableAction, number> = {
    [EXECUTION_ACTION.STANDARD_REPORT]: 100,
    [EXECUTION_ACTION.AI_ANALYSIS]: 500,
    [EXECUTION_ACTION.DEEP_ANALYSIS]: 1_000,
    [EXECUTION_ACTION.FULL_AUDIT]: 2_000,
} as const;

// --- Schemas ---

export const SpendExecutionsSchema = z.object({
    action: z.enum(SPENDABLE_ACTIONS),
});

export type SpendExecutions = z.infer<typeof SpendExecutionsSchema>;

export const ExecutionTransactionItemSchema = z.object({
    id: z.string(),
    type: z.enum([
        EXECUTION_TRANSACTION_TYPE.CREDIT,
        EXECUTION_TRANSACTION_TYPE.DEBIT,
    ]),
    action: z.string(),
    amount: z.number().int().positive(),
    balanceAfter: z.number().int().min(0),
    createdAt: z.coerce.date(),
});

export type ExecutionTransactionItem = z.infer<
    typeof ExecutionTransactionItemSchema
>;

export const PaginatedTransactionsSchema = z.object({
    items: z.array(ExecutionTransactionItemSchema),
    hasMore: z.boolean(),
});

export type PaginatedTransactions = z.infer<typeof PaginatedTransactionsSchema>;
