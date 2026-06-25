import { BillingWebhookEvent } from '@finly/types';

/**
 * Абстракція провайдера білінгу. Sprint 22 — monobank «Плата» без власного
 * рекуренту: розклад веде наш billing-clock, провайдер зведений до чотирьох
 * можливостей — хостований checkout із захопленням токена, разове списання за
 * токеном (merchant-initiated, без 3DS), запит статусу рахунку для звірки і
 * розбір/верифікація вебхука. Жодного suspend/resume/remove/change/refund.
 */

export interface SubscriptionCheckoutInput {
    userId: string;
    userEmail: string;
    /** Наш reference (маршрутизація вебхука), проштовхується у merchantPaymInfo. */
    orderReference: string;
    /** Стабільний per-user гаманець monobank, до якого привʼязується токен. */
    walletId: string;
    planName: string;
    amount: number; // копійки
    currency: string;
    /** Server-to-server callback URL (вебхук). */
    serviceUrl: string;
    /** Куди повертається користувач після оплати. */
    returnUrl: string;
}

export interface OneOffCheckoutInput {
    userId: string;
    userEmail: string;
    orderReference: string;
    productName: string;
    amount: number; // копійки
    currency: string;
    serviceUrl: string;
    returnUrl: string;
}

export interface CheckoutResult {
    checkoutUrl: string;
    invoiceId: string;
    orderReference: string;
}

export interface ChargeByTokenInput {
    /** Детермінований reference спроби (claim-first ключ). */
    orderReference: string;
    cardToken: string;
    amount: number; // копійки
    currency: string;
    productName: string;
    /** Вебхук на фінальний статус (вторинний — основний шлях через результат/статус). */
    serviceUrl: string;
}

export interface ChargeResult {
    /** monobank invoiceId — ключ для подальшого запиту статусу. */
    invoiceId: string;
    /** Статус рахунку monobank (success / failure / processing / ...). */
    status: string;
    cardMask: string | null;
    /** Свіжий токен картки, якщо провайдер його ротував. */
    cardToken: string | null;
    failureReason: string | null;
    errCode: string | null;
}

export interface WebhookParseResult {
    /** null, якщо підпис невалідний або подію треба ігнорувати. */
    event: BillingWebhookEvent | null;
}

/**
 * Помилка виклику провайдера. `chargeDefinitelyNotApplied` — true ЛИШЕ коли
 * провайдер відповів кодом-відмовою рівня запиту (HTTP 4xx): інструкцію відхилено
 * ДО будь-якого списання, гроші точно не рухались, тож спробу можна безпечно
 * повторити. Для таймауту, мережевого збою чи 5xx результат НЕВІДОМИЙ (false) —
 * повторне списання заборонене (money-safety: гроші могли піти).
 */
export class ProviderRequestError extends Error {
    constructor(
        message: string,
        readonly chargeDefinitelyNotApplied: boolean
    ) {
        super(message);
        this.name = 'ProviderRequestError';
    }
}

export interface IPaymentProvider {
    createSubscriptionCheckout(
        input: SubscriptionCheckoutInput
    ): Promise<CheckoutResult>;
    createOneOffCheckout(input: OneOffCheckoutInput): Promise<CheckoutResult>;
    chargeByToken(input: ChargeByTokenInput): Promise<ChargeResult>;
    /**
     * Запит статусу рахунку для звірки сумнівних списань. Нормалізує відповідь у
     * `BillingWebhookEvent` — той самий shape, що й вебхук, тож сервіс зводить
     * стан одним кодом незалежно від джерела. null, якщо рахунок не знайдено.
     */
    getInvoiceStatus(
        invoiceId: string,
        orderReference: string
    ): Promise<BillingWebhookEvent | null>;
    /**
     * Розбір і верифікація вебхука. `signature` — заголовок `X-Sign` (base64
     * ECDSA-SHA256 над сирим тілом). Без acceptResponse: monobank достатньо 200.
     */
    parseWebhook(
        rawBody: Buffer,
        signature: string | undefined
    ): Promise<WebhookParseResult>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
