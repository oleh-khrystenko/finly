import { apiClient, publicFetchJson } from './client';
import type {
    Business,
    BusinessWithCounts,
    CreateBusinessRequest,
    PublicBusinessView,
    SlugAvailabilityResponse,
    SlugReservationView,
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

/**
 * Список бізнесів кабінету. `context` робить запит самодостатнім: бекенд
 * фільтрує власні (`own`) vs клієнтські (`client`) за параметром, а не за
 * персистентним `worksAsBookkeeper`. Без цього перемикач режиму ловив
 * read-after-write race з паралельним PATCH профілю. Відсутній context →
 * бекенд бере персистентний флаг (напр., initial-load до взаємодії).
 */
export async function listBusinesses(
    context?: 'own' | 'client'
): Promise<BusinessWithCounts[]> {
    const { data } = await apiClient.get<{
        data: BusinessWithCounts[];
    }>('/businesses/me', context ? { params: { context } } : undefined);
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

export async function resetBusinessSlug(slug: string): Promise<Business> {
    const { data } = await apiClient.post<{ data: Business }>(
        `/businesses/me/${encodeURIComponent(slug)}/reset-slug`
    );
    return data.data;
}

/**
 * Sprint 20 — live-перевірка доступності бажаного бізнес-slug (усі рівні).
 */
export async function checkBusinessSlugAvailability(
    slug: string,
    desired: string
): Promise<SlugAvailabilityResponse> {
    const { data } = await apiClient.get<{ data: SlugAvailabilityResponse }>(
        `/businesses/me/${encodeURIComponent(slug)}/slug-availability`,
        { params: { slug: desired } }
    );
    return data.data;
}

/** Sprint 20 — холд бажаного вільного бізнес-slug за користувачем (free-flow). */
export async function reserveBusinessSlug(
    slug: string,
    desired: string
): Promise<SlugReservationView> {
    const { data } = await apiClient.post<{ data: SlugReservationView }>(
        `/businesses/me/${encodeURIComponent(slug)}/slug-reservation`,
        { slug: desired }
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
