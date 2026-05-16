import { apiClient } from './client';
import { PAYMENT_TYPE, type PaymentsCatalog } from '@finly/types';

export async function getCatalog(): Promise<PaymentsCatalog> {
    const { data } = await apiClient.get<{ data: PaymentsCatalog }>(
        '/payments/catalog'
    );
    return data.data;
}

export async function createSubscriptionCheckout(
    planCode: string,
    returnPath?: string
): Promise<{ checkoutUrl: string }> {
    const { data } = await apiClient.post<{
        data: { checkoutUrl: string };
    }>('/payments/checkout-session', {
        paymentType: PAYMENT_TYPE.SUBSCRIPTION,
        planCode,
        ...(returnPath && { returnPath }),
    });
    return data.data;
}

export async function createOneOffCheckout(
    packCode: string,
    returnPath?: string
): Promise<{ checkoutUrl: string }> {
    const { data } = await apiClient.post<{
        data: { checkoutUrl: string };
    }>('/payments/checkout-session', {
        paymentType: PAYMENT_TYPE.ONE_OFF,
        packCode,
        ...(returnPath && { returnPath }),
    });
    return data.data;
}

export async function createPortalSession(): Promise<{
    portalUrl: string;
}> {
    const { data } = await apiClient.post<{
        data: { portalUrl: string };
    }>('/payments/portal-session');
    return data.data;
}

export async function resetBilling(): Promise<void> {
    await apiClient.post('/payments/reset');
}
