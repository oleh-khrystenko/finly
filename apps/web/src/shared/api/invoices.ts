import { apiClient, publicFetchJson } from './client';
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
 *
 * **`publicFetchJson` (review fix), не cabinet `apiClient`.** Контракт
 * endpoint-а: `Cache-Control: no-store` (Sprint 4 review — invoice mutable
 * payment data, aggressive shared cache створював би correctness-ризик —
 * див. `public-invoices.controller.ts`). Тобто кеш-rationale тут не
 * актуальний; реальна причина окремого client-а — **public/cabinet
 * isolation** (§3.9): cabinet apiClient шле `Authorization: Bearer ...` +
 * cookies, а public hop має бути identical для anonymous і authed user-а
 * (інакше preview-toggle і реальний render клієнта розходяться, плюс
 * session-identifiers leak-аються у public контур).
 *
 * Native fetch + `credentials: 'omit'` — єдиний спосіб справді не
 * надіслати cookies на same-origin /api (axios `withCredentials: false` для
 * same-origin не вирізає cookies — XHR-обмеження, див. `client.ts`).
 */
export async function getPublicInvoiceView(
    businessSlug: string,
    invoiceSlug: string,
): Promise<PublicInvoiceView> {
    const json = await publicFetchJson<{ data: unknown }>(
        `/businesses/public/${encodeURIComponent(businessSlug)}/invoices/${encodeURIComponent(invoiceSlug)}`,
    );
    return PublicInvoiceSchema.parse(json.data);
}
