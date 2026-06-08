// --- Action Identifiers ---
//
// Sprint 18 знесла DEBIT-сторону (cabinet-чат + резервації). Лишились лише
// CREDIT-нарахування з білінгу та системний `BILLING_RESET`. Spend-екшени
// (report/ai/deep/audit), їхні вартості та spend/history-схеми видалені разом
// з ендпоінтами — повернуться з документ-агентом як простий лічильник-квота,
// не як валюта з резерваціями.

export const EXECUTION_ACTION = {
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
