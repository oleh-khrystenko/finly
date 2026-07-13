import { apiClient } from './client';
import type {
    BillingCatalog,
    BillingProfileView,
    BuyCredits,
    ChangeCapacity,
    CreditLedgerEntry,
    ManageAttachment,
    PaymentRecord,
    PriceCalculation,
    PriceCalculatorQuery,
    StartCheckout,
} from '@finly/types';

export async function getCatalog(): Promise<BillingCatalog> {
    const { data } = await apiClient.get<{ data: BillingCatalog }>(
        '/payments/catalog'
    );
    return data.data;
}

/** Публічний зріз білінг-профілю платника (null — профілю ще немає). */
export async function getBillingProfile(): Promise<BillingProfileView | null> {
    const { data } = await apiClient.get<{ data: BillingProfileView | null }>(
        '/payments/profile'
    );
    return data.data;
}

/** Перша купівля: хостований checkout (захоплення токена, день-якір). */
export async function startCheckout(
    dto: StartCheckout
): Promise<{ checkoutUrl: string }> {
    const { data } = await apiClient.post<{ data: { checkoutUrl: string } }>(
        '/payments/checkout',
        dto
    );
    return data.data;
}

/** Зміна ємності складу (збільшення — доплата за токеном; зменшення — з циклу). */
export async function changeCapacity(
    dto: ChangeCapacity
): Promise<{ immediateCharge: number; scheduled: boolean }> {
    const { data } = await apiClient.post<{
        data: { immediateCharge: number; scheduled: boolean };
    }>('/payments/capacity', dto);
    return data.data;
}

export async function attachBusiness(dto: ManageAttachment): Promise<void> {
    await apiClient.post('/payments/attach', dto);
}

export async function detachBusiness(dto: ManageAttachment): Promise<void> {
    await apiClient.post('/payments/detach', dto);
}

export async function buyCredits(
    dto: BuyCredits
): Promise<{ charged: number; scheduled: boolean }> {
    const { data } = await apiClient.post<{
        data: { charged: number; scheduled: boolean };
    }>('/payments/credits/buy', dto);
    return data.data;
}

/** Калькулятор ціни складу для живого UI (без мутацій). */
export async function calculatePrice(
    dto: PriceCalculatorQuery
): Promise<PriceCalculation> {
    const { data } = await apiClient.post<{ data: PriceCalculation }>(
        '/payments/calculator',
        dto
    );
    return data.data;
}

/** Скасування у кінці періоду (єдиний режим). Тіла немає. */
export async function cancelSubscription(): Promise<void> {
    await apiClient.post('/payments/subscription/cancel');
}

/** Відновлення під час прострочки («оплатити зараз»): переоформлює checkout. */
export async function resumeSubscription(
    returnPath?: string
): Promise<{ checkoutUrl: string }> {
    const { data } = await apiClient.post<{ data: { checkoutUrl: string } }>(
        '/payments/subscription/resume',
        { ...(returnPath && { returnPath }) }
    );
    return data.data;
}

export async function listPayments(limit?: number): Promise<PaymentRecord[]> {
    const { data } = await apiClient.get<{ data: PaymentRecord[] }>(
        '/payments/payments',
        { params: limit ? { limit } : undefined }
    );
    return data.data;
}

export async function listCreditLedger(
    limit?: number
): Promise<CreditLedgerEntry[]> {
    const { data } = await apiClient.get<{ data: CreditLedgerEntry[] }>(
        '/payments/credits/ledger',
        { params: limit ? { limit } : undefined }
    );
    return data.data;
}
