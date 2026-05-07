import { apiClient } from './client';
import {
    InvoiceSchema,
    PublicInvoiceSchema,
    type CreateInvoiceRequest,
    type Invoice,
    type PublicInvoiceView,
    type UpdateInvoiceRequest,
} from '@finly/types';

/**
 * Sprint 4 §4.2 §4.3 — cabinet/public API client для інвойсів.
 * Усі cabinet-методи на `/businesses/me/:slug/invoices/...` під JwtActiveGuard;
 * envelope `{ data: ... }`. Public-методи без auth.
 *
 * **Zod-parse на boundary** (Sprint 4 review fix). API повертає JSON, де Date-
 * поля (`validUntil`, `createdAt`, `updatedAt`, `deletedAt`) серіалізовані як
 * ISO-strings. `InvoiceSchema` / `PublicInvoiceSchema` мають `z.coerce.date()`
 * — `.parse()` нормалізує string → Date instance, тож consumer отримує
 * runtime-shape, що відповідає TS-типу `Invoice` (validUntil: Date | null).
 *
 * Без цього — read-only place у UI (например `toLocaleDateString` через
 * `new Date(v)`) випадково працює, але edit-mode (`<input type="date">` що
 * перевіряє `value instanceof Date`) — ні. Тести з мок-датами не ловлять
 * boundary-проблему.
 */

export interface PaginatedInvoices {
    items: Invoice[];
    total: number;
    page: number;
    limit: number;
}

interface PaginatedInvoicesEnvelope {
    items: unknown[];
    total: number;
    page: number;
    limit: number;
}

export async function listInvoices(
    businessSlug: string,
    page = 1,
    limit = 10,
): Promise<PaginatedInvoices> {
    const { data } = await apiClient.get<{ data: PaginatedInvoicesEnvelope }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/invoices`,
        { params: { page, limit } },
    );
    return {
        items: data.data.items.map((raw) => InvoiceSchema.parse(raw)),
        total: data.data.total,
        page: data.data.page,
        limit: data.data.limit,
    };
}

export async function createInvoice(
    businessSlug: string,
    dto: CreateInvoiceRequest,
): Promise<Invoice> {
    const { data } = await apiClient.post<{ data: unknown }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/invoices`,
        dto,
    );
    return InvoiceSchema.parse(data.data);
}

export async function getInvoiceBySlug(
    businessSlug: string,
    invoiceSlug: string,
): Promise<Invoice> {
    const { data } = await apiClient.get<{ data: unknown }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/invoices/${encodeURIComponent(invoiceSlug)}`,
    );
    return InvoiceSchema.parse(data.data);
}

export async function updateInvoice(
    businessSlug: string,
    invoiceSlug: string,
    dto: UpdateInvoiceRequest,
): Promise<Invoice> {
    const { data } = await apiClient.patch<{ data: unknown }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/invoices/${encodeURIComponent(invoiceSlug)}`,
        dto,
    );
    return InvoiceSchema.parse(data.data);
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
    const { data } = await apiClient.get<{ data: unknown }>(
        `/businesses/public/${encodeURIComponent(businessSlug)}/invoices/${encodeURIComponent(invoiceSlug)}`,
    );
    return PublicInvoiceSchema.parse(data.data);
}
