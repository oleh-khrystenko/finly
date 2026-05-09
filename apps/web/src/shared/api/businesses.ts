import { apiClient, publicFetchJson } from './client';
import type {
    Business,
    BusinessWithInvoicesCount,
    CreateBusinessRequest,
    PublicBusinessView,
    UpdateBusinessRequest,
} from '@finly/types';
export type { BusinessWithInvoicesCount } from '@finly/types';

/**
 * Sprint 3 §3.6 §3.8 + Sprint 4 §4.4 — cabinet API client для бізнесів.
 * Усі методи на `/businesses/me` під JwtActiveGuard; envelope `{ data: ... }`.
 *
 * **Sprint 4 §4.4: `BusinessWithInvoicesCount`** — view-extension type
 * (`Business & { invoicesCount }`) визначений у `@finly/types/contracts/
 * businesses` як shared contract. Backend (service + controller) і frontend
 * декларують повернення цього типу — single source of truth.
 */

export async function listBusinesses(): Promise<BusinessWithInvoicesCount[]> {
    const { data } = await apiClient.get<{
        data: BusinessWithInvoicesCount[];
    }>('/businesses/me');
    return data.data;
}

export async function createBusiness(
    dto: CreateBusinessRequest
): Promise<Business> {
    const { data } = await apiClient.post<{ data: Business }>(
        '/businesses/me',
        dto
    );
    return data.data;
}

export async function getBusinessBySlug(
    slug: string
): Promise<BusinessWithInvoicesCount> {
    const { data } = await apiClient.get<{ data: BusinessWithInvoicesCount }>(
        `/businesses/me/${encodeURIComponent(slug)}`
    );
    return data.data;
}

export async function updateBusiness(
    slug: string,
    dto: UpdateBusinessRequest
): Promise<Business> {
    const { data } = await apiClient.patch<{ data: Business }>(
        `/businesses/me/${encodeURIComponent(slug)}`,
        dto
    );
    return data.data;
}

export async function deleteBusiness(slug: string): Promise<void> {
    await apiClient.delete(`/businesses/me/${encodeURIComponent(slug)}`);
}

/**
 * Sprint 3 §3.3 + §3.8 (preview-toggle) — public-зона view. Cabinet preview-
 * mode викликає це для рендеру `<PublicBusinessView>` без leak реквізитів
 * через cabinet-endpoint.
 *
 * **`publicFetchJson` (review fix), не cabinet `apiClient`.** Endpoint має
 * `Cache-Control: public, max-age=3600, SWR=86400`, тож тут на відміну від
 * invoice-варіанту обидва rationale діють:
 *   1. **CDN-cache contract** — cabinet apiClient шле `Authorization` +
 *      cookies; CDN автоматично знімає shared-cache eligibility з authed
 *      requests, навіть якщо API відповідає `Cache-Control: public`.
 *   2. **Public/cabinet isolation §3.9** — public response identical для
 *      anonymous і authed user-а; жодного session-identifier-у у public hop.
 *
 * Same-origin /api у prod-like setup-i: axios `withCredentials: false`
 * не блокує cookies (XHR-обмеження). Native fetch з `credentials: 'omit'`
 * — єдиний реальний механізм. Деталі — `client.ts`.
 */
export async function getPublicBusinessView(
    slug: string
): Promise<PublicBusinessView> {
    const json = await publicFetchJson<{ data: PublicBusinessView }>(
        `/businesses/public/${encodeURIComponent(slug)}`
    );
    return json.data;
}
