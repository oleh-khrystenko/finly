import type {
    Account,
    AccountWithCounts,
    ApprovePublicityRequest,
    Business,
    CreateSystemPayeeAccountRequest,
    CreateSystemPayeeRequest,
    RejectPublicityRequest,
    UpdateSystemPayeeAccountRequest,
    UpdateSystemPayeeRequest,
} from '@finly/types';

import { apiClient } from './client';

/**
 * Sprint 29 — адмін-API для системних отримувачів і черги публічності. Усі
 * маршрути під JwtActiveGuard + AdminGuard; envelope `{ data }`.
 */

export async function adminListPayees(): Promise<Business[]> {
    const { data } = await apiClient.get<{ data: Business[] }>('/admin/payees');
    return data.data;
}

export async function adminCreatePayee(
    dto: CreateSystemPayeeRequest
): Promise<Business> {
    const { data } = await apiClient.post<{ data: Business }>(
        '/admin/payees',
        dto
    );
    return data.data;
}

export async function adminGetPayee(slug: string): Promise<{
    business: Business;
    accounts: AccountWithCounts[];
}> {
    const { data } = await apiClient.get<{
        data: { business: Business; accounts: AccountWithCounts[] };
    }>(`/admin/payees/${encodeURIComponent(slug)}`);
    return data.data;
}

export async function adminUpdatePayee(
    slug: string,
    dto: UpdateSystemPayeeRequest
): Promise<Business> {
    const { data } = await apiClient.patch<{ data: Business }>(
        `/admin/payees/${encodeURIComponent(slug)}`,
        dto
    );
    return data.data;
}

export async function adminDeletePayee(slug: string): Promise<void> {
    await apiClient.delete(`/admin/payees/${encodeURIComponent(slug)}`);
}

/**
 * Реквізити системного отримувача. Контракт власний (не кабінетний
 * `CreateAccountRequest`): призначення тут приймає маркери підстановки, бо
 * сторінку контролює адмін.
 */
export async function adminCreatePayeeAccount(
    slug: string,
    dto: CreateSystemPayeeAccountRequest
): Promise<Account> {
    const { data } = await apiClient.post<{ data: Account }>(
        `/admin/payees/${encodeURIComponent(slug)}/accounts`,
        dto
    );
    return data.data;
}

/**
 * Sprint 29 — редагування реквізитів системного отримувача: назва, красивий
 * slug (поза Brand-гейтингом) і власне призначення платежу з маркерами. Окремий
 * від кабінетного PATCH, бо той резолвить бізнес за власником, а у системного
 * запису власника немає.
 */
export async function adminUpdatePayeeAccount(
    slug: string,
    accountSlug: string,
    dto: UpdateSystemPayeeAccountRequest
): Promise<Account> {
    const { data } = await apiClient.patch<{ data: Account }>(
        `/admin/payees/${encodeURIComponent(slug)}/accounts/${encodeURIComponent(accountSlug)}`,
        dto
    );
    return data.data;
}

export async function adminDeletePayeeAccount(
    slug: string,
    accountSlug: string
): Promise<void> {
    await apiClient.delete(
        `/admin/payees/${encodeURIComponent(slug)}/accounts/${encodeURIComponent(accountSlug)}`
    );
}

/** Sprint 29 — тогл видимості системного отримувача у каталозі (миттєвий важіль). */
export async function adminSetPayeeCatalogVisibility(
    slug: string,
    visible: boolean
): Promise<Business> {
    const { data } = await apiClient.patch<{ data: Business }>(
        `/admin/payees/${encodeURIComponent(slug)}/catalog-visibility`,
        { visible }
    );
    return data.data;
}

/** Sprint 29 — тогл видимості реквізитів системного отримувача у каталозі. */
export async function adminSetPayeeAccountCatalogVisibility(
    slug: string,
    accountSlug: string,
    visible: boolean
): Promise<Account> {
    const { data } = await apiClient.patch<{ data: Account }>(
        `/admin/payees/${encodeURIComponent(slug)}/accounts/${encodeURIComponent(accountSlug)}/catalog-visibility`,
        { visible }
    );
    return data.data;
}

export async function adminListPublicityQueue(): Promise<Business[]> {
    const { data } = await apiClient.get<{ data: Business[] }>(
        '/admin/publicity'
    );
    return data.data;
}

/** Схвалені отримувачі у каталозі — адмінський список для зняття схвалення. */
export async function adminListApprovedPublicity(): Promise<Business[]> {
    const { data } = await apiClient.get<{ data: Business[] }>(
        '/admin/publicity/approved'
    );
    return data.data;
}

export async function adminApprovePublicity(
    slug: string,
    dto: ApprovePublicityRequest
): Promise<Business> {
    const { data } = await apiClient.post<{ data: Business }>(
        `/admin/publicity/${encodeURIComponent(slug)}/approve`,
        dto
    );
    return data.data;
}

export async function adminRejectPublicity(
    slug: string,
    dto: RejectPublicityRequest
): Promise<Business> {
    const { data } = await apiClient.post<{ data: Business }>(
        `/admin/publicity/${encodeURIComponent(slug)}/reject`,
        dto
    );
    return data.data;
}
