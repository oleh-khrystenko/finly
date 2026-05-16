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
 * Sprint 4 §4.2 §4.3 + Sprint 9 §SP-5 — cabinet/public API client для інвойсів.
 *
 * **Sprint 9 URL-ремайнінг (матрьошка §SP-5):**
 *  - cabinet: `/businesses/me/{businessSlug}/accounts/{accountSlug}/invoices/...`
 *  - public:  `/businesses/public/{businessSlug}/account/{accountSlug}/invoices/...`
 *
 * Інвойсна нумерація per-account (§SP-6) — slug-uniqueness `(accountId, slug)`,
 * тому всі endpoint-и параметризуються `accountSlug`.
 *
 * **Zod-parse на boundary** (Sprint 4 review fix). API повертає JSON з ISO-string
 * dates; `InvoiceSchema` / `PublicInvoiceSchema` мають `z.coerce.date()` →
 * consumer отримує runtime-shape з Date instance-ами, що відповідає TS-типу.
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

function invoicesBase(businessSlug: string, accountSlug: string): string {
    return `/businesses/me/${encodeURIComponent(businessSlug)}/accounts/${encodeURIComponent(accountSlug)}/invoices`;
}

export async function listInvoices(
    businessSlug: string,
    accountSlug: string,
    page = 1,
    limit = 10
): Promise<PaginatedInvoices> {
    const { data } = await apiClient.get<{ data: PaginatedInvoicesEnvelope }>(
        invoicesBase(businessSlug, accountSlug),
        { params: { page, limit } }
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
    accountSlug: string,
    dto: CreateInvoiceRequest
): Promise<Invoice> {
    const { data } = await apiClient.post<{ data: unknown }>(
        invoicesBase(businessSlug, accountSlug),
        dto
    );
    return InvoiceSchema.parse(data.data);
}

export async function getInvoiceBySlug(
    businessSlug: string,
    accountSlug: string,
    invoiceSlug: string
): Promise<Invoice> {
    const { data } = await apiClient.get<{ data: unknown }>(
        `${invoicesBase(businessSlug, accountSlug)}/${encodeURIComponent(invoiceSlug)}`
    );
    return InvoiceSchema.parse(data.data);
}

export async function updateInvoice(
    businessSlug: string,
    accountSlug: string,
    invoiceSlug: string,
    dto: UpdateInvoiceRequest
): Promise<Invoice> {
    const { data } = await apiClient.patch<{ data: unknown }>(
        `${invoicesBase(businessSlug, accountSlug)}/${encodeURIComponent(invoiceSlug)}`,
        dto
    );
    return InvoiceSchema.parse(data.data);
}

export async function deleteInvoice(
    businessSlug: string,
    accountSlug: string,
    invoiceSlug: string
): Promise<void> {
    await apiClient.delete(
        `${invoicesBase(businessSlug, accountSlug)}/${encodeURIComponent(invoiceSlug)}`
    );
}

/**
 * Sprint 4 §4.3 + Sprint 9 — public-зона view. URL 3-сегментний:
 * `/businesses/public/:slug/account/:accountSlug/invoices/:invoiceSlug`.
 * Для cabinet preview-toggle (Sprint 4 §4.6 + Sprint 9 §9.2 §6).
 *
 * **`publicFetchJson` (review fix)** — `credentials: 'omit'`, public/cabinet
 * isolation §3.9.
 */
export async function getPublicInvoiceView(
    businessSlug: string,
    accountSlug: string,
    invoiceSlug: string
): Promise<PublicInvoiceView> {
    const json = await publicFetchJson<{ data: unknown }>(
        `/businesses/public/${encodeURIComponent(businessSlug)}/account/${encodeURIComponent(accountSlug)}/invoices/${encodeURIComponent(invoiceSlug)}`
    );
    return PublicInvoiceSchema.parse(json.data);
}
