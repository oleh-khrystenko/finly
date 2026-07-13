import { z } from 'zod';

// --- Billing-wide constants ---
// Один продукт = одна валюта (гривня).
export const BILLING_CURRENCY = 'UAH';

export type BillingInterval = 'month' | 'year';

// --- Status & Event Enums ---

export const SUBSCRIPTION_STATUS = {
    /** Профіль активний, billing-clock спише його у `nextChargeAt`. */
    ACTIVE: 'ACTIVE',
    /** Списання продовження відхилено, доступ тримається на грейс-вікно dunning. */
    PAST_DUE: 'PAST_DUE',
    /** Скасований користувачем у кінці періоду або після вичерпання грейсу. */
    CANCELED: 'CANCELED',
    /** Checkout створено, перше списання ще не підтверджене. */
    INCOMPLETE: 'INCOMPLETE',
    /** Грейс dunning вичерпано без оплати — доступ знято. */
    UNPAID: 'UNPAID',
    UNKNOWN: 'UNKNOWN',
} as const;

export type SubscriptionStatus =
    (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

// --- Payment Record (легка колекція грошових списань) ---
// Джерело історії списань. Наповнюється синхронним результатом / вебхуком.

export const PAYMENT_RECORD_TYPE = {
    /** Місячне списання циклу (чиста сума обох складів). */
    CYCLE: 'cycle',
    /** Негайна пропорційна доплата при збільшенні ємності посеред циклу. */
    PRORATION: 'proration',
    /** Докупівля прихованого пакета кредитів (one-off). */
    CREDIT_PACK: 'credit_pack',
    // Success-списання, яке неможливо звести з чинним станом платника
    // (гроші пройшли, але профіль уже скасовано/перезаписано). Слід для ручного
    // розбору; окремий тип тримає його поза звичайною історією.
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
        PAYMENT_RECORD_TYPE.CYCLE,
        PAYMENT_RECORD_TYPE.PRORATION,
        PAYMENT_RECORD_TYPE.CREDIT_PACK,
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

// --- monobank invoice statuses ---

/**
 * Статуси рахунку monobank «Плата» (`GET /api/merchant/invoice/status` і той
 * самий shape у вебхуку). Термінальні: success / failure / reversed / expired;
 * нетермінальні (проміжні): created / processing / hold.
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
 * класифікує семантику білінгу — це робить сервіс, декодуючи `orderReference`.
 * `amount` — копійки-integer; `cardToken` — secret-токен, у frontend не віддається.
 */
export const BillingWebhookEventSchema = z.object({
    /**
     * Ключ дедуплікації: `${invoiceId}:${status}`. Один invoiceId проходить
     * кілька статус-переходів (processing → success), кожен оброблюється окремо.
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
