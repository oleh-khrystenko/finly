import { apiClient } from './client';
import type {
    Business,
    CreateBusinessRequest,
    PublicBusinessView,
    UpdateBusinessRequest,
} from '@finly/types';

/**
 * Sprint 3 §3.6 §3.8 — cabinet API client для бізнесів. Усі методи на
 * `/businesses/me` під JwtActiveGuard; envelope `{ data: ... }`.
 */

export async function listBusinesses(): Promise<Business[]> {
    const { data } = await apiClient.get<{ data: Business[] }>(
        '/businesses/me',
    );
    return data.data;
}

export async function createBusiness(
    dto: CreateBusinessRequest,
): Promise<Business> {
    const { data } = await apiClient.post<{ data: Business }>(
        '/businesses/me',
        dto,
    );
    return data.data;
}

export async function getBusinessBySlug(slug: string): Promise<Business> {
    const { data } = await apiClient.get<{ data: Business }>(
        `/businesses/me/${encodeURIComponent(slug)}`,
    );
    return data.data;
}

export async function updateBusiness(
    slug: string,
    dto: UpdateBusinessRequest,
): Promise<Business> {
    const { data } = await apiClient.patch<{ data: Business }>(
        `/businesses/me/${encodeURIComponent(slug)}`,
        dto,
    );
    return data.data;
}

export async function deleteBusiness(slug: string): Promise<void> {
    await apiClient.delete(`/businesses/me/${encodeURIComponent(slug)}`);
}

/**
 * Sprint 3 §3.3 + §3.8 (preview-toggle) — public-зона view. Без auth, без
 * cookies; повертає 6 whitelist-полів + nbuLinks. Cabinet preview-mode
 * викликає це для рендеру `<PublicBusinessView>` без leak реквізитів через
 * cabinet-endpoint.
 */
export async function getPublicBusinessView(
    slug: string,
): Promise<PublicBusinessView> {
    const { data } = await apiClient.get<{ data: PublicBusinessView }>(
        `/businesses/public/${encodeURIComponent(slug)}`,
    );
    return data.data;
}
