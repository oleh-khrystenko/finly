import { apiClient } from './client';
import {
    PAYMENT_TYPE,
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

/** Скасування у кінці періоду (єдиний режим). Тіла немає. */
export async function cancelSubscription(): Promise<void> {
    await apiClient.post('/payments/subscription/cancel');
}

/**
 * Відновлення під час прострочки («оплатити зараз»): переоформлює checkout-флоу
 * підписки, гасить борг і захоплює свіжий токен. Повертає URL хостованої сторінки.
 */
export async function resumeSubscription(
    returnPath?: string
): Promise<{ checkoutUrl: string }> {
    const { data } = await apiClient.post<{
        data: { checkoutUrl: string };
    }>('/payments/subscription/resume', {
        ...(returnPath && { returnPath }),
    });
    return data.data;
}

export async function listPayments(limit?: number): Promise<PaymentRecord[]> {
    const { data } = await apiClient.get<{ data: PaymentRecord[] }>(
        '/payments/payments',
        { params: limit ? { limit } : undefined }
    );
    return data.data;
}
