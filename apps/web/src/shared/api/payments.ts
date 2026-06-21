import { apiClient } from './client';
import {
    PAYMENT_TYPE,
    type ChangePlan,
    type PaymentRecord,
    type PaymentsCatalog,
} from '@finly/types';

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
    oneOffCode: string,
    returnPath?: string
): Promise<{ checkoutUrl: string }> {
    const { data } = await apiClient.post<{
        data: { checkoutUrl: string };
    }>('/payments/checkout-session', {
        paymentType: PAYMENT_TYPE.ONE_OFF,
        oneOffCode,
        ...(returnPath && { returnPath }),
    });
    return data.data;
}

export async function cancelSubscription(
    withRefund: boolean
): Promise<{ refundedAmount: number | null }> {
    const { data } = await apiClient.post<{
        data: { refundedAmount: number | null };
    }>('/payments/subscription/cancel', { withRefund });
    return data.data;
}

export async function changePlan(
    planCode: ChangePlan['planCode']
): Promise<{ scheduled: boolean }> {
    const { data } = await apiClient.post<{
        data: { scheduled: boolean };
    }>('/payments/subscription/change-plan', { planCode });
    return data.data;
}

export async function listPayments(limit?: number): Promise<PaymentRecord[]> {
    const { data } = await apiClient.get<{ data: PaymentRecord[] }>(
        '/payments/payments',
        { params: limit ? { limit } : undefined }
    );
    return data.data;
}
