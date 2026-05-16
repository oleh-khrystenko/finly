import { apiClient, publicFetchJson } from './client';
import type {
    Business,
    BusinessWithCounts,
    CreateBusinessRequest,
    PublicBusinessView,
    UpdateBusinessRequest,
} from '@finly/types';

/**
 * Sprint 3 §3.6 §3.8 + Sprint 4 §4.4 + Sprint 9 §9.1 — cabinet API client для
 * бізнесів. Усі методи на `/businesses/me` під JwtActiveGuard; envelope
 * `{ data: ... }`.
 *
 * **Sprint 9: `BusinessWithCounts`** — single source of truth для
 * `Business & { accountsCount, invoicesCount }`. Counter "{N} рахунків /
 * {M} інвойсів усього" на business-картці mitigation для UX-плутанини
 * 1-рахунок-ФОП-а (README Risk #7).
 *
 * **Sprint 9: delete-response shape**: `{ affectedAccounts, affectedInvoices }`.
 */

interface CascadeDeleteResult {
    affectedAccounts: number;
    affectedInvoices: number;
}

export async function listBusinesses(): Promise<BusinessWithCounts[]> {
    const { data } = await apiClient.get<{
        data: BusinessWithCounts[];
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
): Promise<BusinessWithCounts> {
    const { data } = await apiClient.get<{ data: BusinessWithCounts }>(
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

export async function deleteBusiness(slug: string): Promise<CascadeDeleteResult> {
    const { data } = await apiClient.delete<{ data: CascadeDeleteResult }>(
        `/businesses/me/${encodeURIComponent(slug)}`
    );
    return data.data;
}

/**
 * Sprint 3 §3.3 + §3.8 (preview-toggle) + Sprint 9 §SP-4 — public-зона view.
 * Cabinet preview-mode викликає це для рендеру `<PublicBusinessView>` (Sprint 9:
 * cards-list-view для 2+ Account / empty-state для 0; 1-Account 307-redirect
 * живе на Server Component).
 *
 * **`publicFetchJson` (review fix), не cabinet `apiClient`** — public/cabinet
 * isolation §3.9 + CDN-cache contract. Деталі — `client.ts`.
 */
export async function getPublicBusinessView(
    slug: string
): Promise<PublicBusinessView> {
    const json = await publicFetchJson<{ data: PublicBusinessView }>(
        `/businesses/public/${encodeURIComponent(slug)}`
    );
    return json.data;
}
