import { BillingWebhookEvent, PaymentType } from '@neatslip/types';

export interface CreateCheckoutInput {
    userId: string;
    userEmail: string;
    providerCustomerId?: string;
    paymentType: PaymentType;
    planCode: string;
    priceId: string;
    executions?: number;
    successUrl: string;
    cancelUrl: string;
}

export interface CheckoutResult {
    checkoutUrl: string;
    providerSessionId: string;
}

export interface PortalResult {
    portalUrl: string;
}

export interface IPaymentProvider {
    createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutResult>;
    createPortalSession(
        providerCustomerId: string,
        returnUrl: string
    ): Promise<PortalResult>;
    handleWebhookPayload(
        rawBody: Buffer,
        signatureHeader: string
    ): Promise<BillingWebhookEvent | null>;
    deleteCustomerData(providerCustomerId: string): Promise<void>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
