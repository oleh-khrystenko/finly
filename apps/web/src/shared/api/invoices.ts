import { apiClient } from './client';
import type {
    CreateInvoiceRequest,
    Invoice,
    PublicInvoiceView,
    UpdateInvoiceRequest,
} from '@finly/types';

/**
 * Sprint 4 §4.2 §4.3 — cabinet/public API client для інвойсів.
 * Усі cabinet-методи на `/businesses/me/:slug/invoices/...` під JwtActiveGuard;
 * envelope `{ data: ... }`. Public-методи без auth.
 */

export interface PaginatedInvoices {
    items: Invoice[];
    total: number;
    page: number;
    limit: number;
}

export async function listInvoices(
    businessSlug: string,
    page = 1,
    limit = 10,
): Promise<PaginatedInvoices> {
    const { data } = await apiClient.get<{ data: PaginatedInvoices }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/invoices`,
        { params: { page, limit } },
    );
    return data.data;
}

export async function createInvoice(
    businessSlug: string,
    dto: CreateInvoiceRequest,
): Promise<Invoice> {
    const { data } = await apiClient.post<{ data: Invoice }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/invoices`,
        dto,
    );
    return data.data;
}

export async function getInvoiceBySlug(
    businessSlug: string,
    invoiceSlug: string,
): Promise<Invoice> {
    const { data } = await apiClient.get<{ data: Invoice }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/invoices/${encodeURIComponent(invoiceSlug)}`,
    );
    return data.data;
}

export async function updateInvoice(
    businessSlug: string,
    invoiceSlug: string,
    dto: UpdateInvoiceRequest,
): Promise<Invoice> {
    const { data } = await apiClient.patch<{ data: Invoice }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/invoices/${encodeURIComponent(invoiceSlug)}`,
        dto,
    );
    return data.data;
}

export async function deleteInvoice(
    businessSlug: string,
    invoiceSlug: string,
): Promise<void> {
    await apiClient.delete(
        `/businesses/me/${encodeURIComponent(businessSlug)}/invoices/${encodeURIComponent(invoiceSlug)}`,
    );
}

/**
 * Sprint 4 §4.3 — public-зона view для cabinet preview-toggle (Sprint 4 §4.6).
 * Без auth, без cookies; whitelist 7 полів + nbuLinks.
 */
export async function getPublicInvoiceView(
    businessSlug: string,
    invoiceSlug: string,
): Promise<PublicInvoiceView> {
    const { data } = await apiClient.get<{ data: PublicInvoiceView }>(
        `/businesses/public/${encodeURIComponent(businessSlug)}/invoices/${encodeURIComponent(invoiceSlug)}`,
    );
    return data.data;
}
