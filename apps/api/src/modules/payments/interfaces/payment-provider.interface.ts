import { BillingInterval, BillingWebhookEvent } from '@finly/types';

/**
 * Абстракція провайдера білінгу. Reshape під WayForPay (Sprint 17): без
 * priceId/customerId/portal; з операціями над рекурентом, ad-hoc Charge за
 * токеном і вебхук-розбором, що повертає підписаний accept-handshake.
 *
 * Інтерфейс лишається досить загальним, щоб під ним могла жити і чиста Модель B
 * (власний шедулер через recToken+Charge), якщо sandbox змусить перемкнутись.
 */

export interface SubscriptionCheckoutInput {
    userId: string;
    userEmail: string;
    orderReference: string;
    planName: string;
    amount: number; // копійки
    currency: string;
    interval: BillingInterval;
    /** 0 = без trial; >0 = перше списання відкладене на N місяців. */
    trialMonths: number;
    /** Server-to-server callback URL (вебхук). */
    serviceUrl: string;
    /** Куди повертається користувач після оплати. */
    returnUrl: string;
}

export interface OneOffCheckoutInput {
    userId: string;
    userEmail: string;
    orderReference: string;
    packName: string;
    amount: number; // копійки
    currency: string;
    serviceUrl: string;
    returnUrl: string;
}

export interface CheckoutResult {
    checkoutUrl: string;
    orderReference: string;
}

export interface ChargeInput {
    orderReference: string;
    recToken: string;
    amount: number; // копійки
    currency: string;
    description: string;
}

export interface ChargeResult {
    success: boolean;
    transactionId: string | null;
    cardMask: string | null;
    reasonCode: number | null;
    reason: string | null;
}

export interface RefundInput {
    orderReference: string;
    amount: number; // копійки
    currency: string;
    comment: string;
}

export interface RefundResult {
    success: boolean;
    reasonCode: number | null;
    reason: string | null;
}

export interface SubscriptionStatusResult {
    /** Raw lifecycle WayForPay: Active / Suspended / Removed / Created / ... */
    status: string;
    nextPaymentDate: Date | null;
    lastPayedDate: Date | null;
    dateEnd: Date | null;
}

export interface SubscriptionChange {
    amount?: number; // копійки
    currency?: string;
    interval?: BillingInterval;
    nextPaymentDate?: Date;
    endDate?: Date;
}

export interface WebhookParseResult {
    /** null, якщо підпис невалідний або подію треба ігнорувати. */
    event: BillingWebhookEvent | null;
    /**
     * Підписане тіло accept-handshake, яке контролер віддає назад WayForPay.
     * Завжди присутнє для валідного-за-структурою колбеку (навіть якщо event
     * ігнорується) — інакше WayForPay шле повтори. null лише на невалідному
     * підписі.
     */
    acceptResponse: string | null;
}

export interface IPaymentProvider {
    createSubscriptionCheckout(
        input: SubscriptionCheckoutInput
    ): Promise<CheckoutResult>;
    createOneOffCheckout(input: OneOffCheckoutInput): Promise<CheckoutResult>;
    /** Ad-hoc списання за збереженим токеном картки (proration-доплата). */
    chargeByToken(input: ChargeInput): Promise<ChargeResult>;
    refund(input: RefundInput): Promise<RefundResult>;
    getSubscriptionStatus(
        orderReference: string
    ): Promise<SubscriptionStatusResult>;
    suspendSubscription(orderReference: string): Promise<void>;
    resumeSubscription(orderReference: string): Promise<void>;
    removeSubscription(orderReference: string): Promise<void>;
    changeSubscription(
        orderReference: string,
        change: SubscriptionChange
    ): Promise<void>;
    parseWebhook(rawBody: Buffer): Promise<WebhookParseResult>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
