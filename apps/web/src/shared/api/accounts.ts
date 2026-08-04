import { apiClient, publicFetchJson } from './client';
import type {
    Account,
    AccountWithCounts,
    CreateAccountRequest,
    PersonalizedNbuLinks,
    PublicAccountView,
    SlugAvailabilityResponse,
    SlugReservationView,
    UpdateAccountRequest,
} from '@finly/types';

/**
 * Sprint 9 §9.2 — cabinet/public API client для accounts.
 *
 * Усі cabinet-методи на `/businesses/me/:slug/accounts/...` під JwtActiveGuard
 * + BusinessAccessGuard. Envelope `{ data: ... }`. Public-метод без auth — той
 * самий `publicFetchJson` patern, що Sprint 3 `getPublicBusinessView`
 * (`credentials: 'omit'` — public/cabinet isolation §3.9).
 */

export async function listAccounts(
    businessSlug: string
): Promise<AccountWithCounts[]> {
    const { data } = await apiClient.get<{ data: AccountWithCounts[] }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/accounts`
    );
    return data.data;
}

export async function createAccount(
    businessSlug: string,
    dto: CreateAccountRequest
): Promise<Account> {
    const { data } = await apiClient.post<{ data: Account }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/accounts`,
        dto
    );
    return data.data;
}

export async function getAccountBySlug(
    businessSlug: string,
    accountSlug: string
): Promise<AccountWithCounts> {
    const { data } = await apiClient.get<{ data: AccountWithCounts }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/accounts/${encodeURIComponent(accountSlug)}`
    );
    return data.data;
}

export async function updateAccount(
    businessSlug: string,
    accountSlug: string,
    dto: UpdateAccountRequest
): Promise<Account> {
    const { data } = await apiClient.patch<{ data: Account }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/accounts/${encodeURIComponent(accountSlug)}`,
        dto
    );
    return data.data;
}

export async function resetAccountSlug(
    businessSlug: string,
    accountSlug: string
): Promise<Account> {
    const { data } = await apiClient.post<{ data: Account }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/accounts/${encodeURIComponent(accountSlug)}/reset-slug`
    );
    return data.data;
}

/** Sprint 20 — live-доступність бажаного slug рахунку (у scope бізнесу). */
export async function checkAccountSlugAvailability(
    businessSlug: string,
    accountSlug: string,
    desired: string
): Promise<SlugAvailabilityResponse> {
    const { data } = await apiClient.get<{ data: SlugAvailabilityResponse }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/accounts/${encodeURIComponent(accountSlug)}/slug-availability`,
        { params: { slug: desired } }
    );
    return data.data;
}

/** Sprint 20 — холд бажаного вільного slug рахунку за користувачем. */
export async function reserveAccountSlug(
    businessSlug: string,
    accountSlug: string,
    desired: string
): Promise<SlugReservationView> {
    const { data } = await apiClient.post<{ data: SlugReservationView }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/accounts/${encodeURIComponent(accountSlug)}/slug-reservation`,
        { slug: desired }
    );
    return data.data;
}

export async function deleteAccount(
    businessSlug: string,
    accountSlug: string
): Promise<void> {
    await apiClient.delete(
        `/businesses/me/${encodeURIComponent(businessSlug)}/accounts/${encodeURIComponent(accountSlug)}`
    );
}

/** Sprint 29 — тогл видимості реквізитів у каталозі (лише за допущеного рівня). */
export async function setAccountCatalogVisibility(
    businessSlug: string,
    accountSlug: string,
    visible: boolean
): Promise<Account> {
    const { data } = await apiClient.patch<{ data: Account }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/accounts/${encodeURIComponent(accountSlug)}/catalog-visibility`,
        { visible }
    );
    return data.data;
}

/**
 * Public per-account view — для cabinet preview-toggle (Sprint 9 §9.2 §6 QR-секція
 * mirror-ить public 1:1). Зчитує `nbuLinks` + `ibanMask` + nested `business` shape.
 */
export async function getPublicAccountView(
    businessSlug: string,
    accountSlug: string
): Promise<PublicAccountView> {
    const json = await publicFetchJson<{ data: PublicAccountView }>(
        `/businesses/public/${encodeURIComponent(businessSlug)}/account/${encodeURIComponent(accountSlug)}`
    );
    return json.data;
}

/**
 * Sprint 29 — персоналізовані NBU-посилання (universal-links) для податкової
 * сторінки. `values` — заповнені підстановки (РНОКПП/період/ПІБ) як query.
 */
export async function getPersonalizedNbuLinks(
    businessSlug: string,
    accountSlug: string,
    values: Record<string, string>
): Promise<PersonalizedNbuLinks['nbuLinks']> {
    const qs = new URLSearchParams(values).toString();
    const json = await publicFetchJson<{ data: PersonalizedNbuLinks }>(
        `/businesses/public/${encodeURIComponent(businessSlug)}/account/${encodeURIComponent(accountSlug)}/personalized-links?${qs}`
    );
    return json.data.nbuLinks;
}
