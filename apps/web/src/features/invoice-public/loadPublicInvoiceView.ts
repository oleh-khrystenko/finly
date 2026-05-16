import { PublicInvoiceSchema, type PublicInvoiceView } from '@finly/types';

/**
 * Sprint 4 §4.7 + Sprint 9 §SP-6 — server-side fetch публічного view інвойсу
 * для Server Component на
 * `app/host-pay/[slug]/[accountSlug]/[invoiceSlug]/page.tsx`.
 *
 * **Sprint 9 URL ремайнінг**: 3-сегментний path
 * `/businesses/public/:slug/account/:accountSlug/invoices/:invoiceSlug` —
 * інвойси переїхали під account-namespace через §SP-6 per-account-counter
 * (compound-unique invoice-slug став `(accountId, slug)`, не `(businessId, slug)`).
 *
 * Server-only native fetch до `API_INTERNAL_URL`. `cache: 'no-store'`
 * (Sprint 4 review fix): invoice — mutable payment-команда; видалений
 * рахунок ще видно з ISR-кешу, стара сума показується після редагування.
 * CDN-relief через ETag, якщо знадобиться, — не через time-based ISR.
 *
 * **Zod-parse на boundary** — API JSON містить дати як ISO-strings;
 * `PublicInvoiceSchema` (`z.coerce.date()`) нормалізує `validUntil` у `Date`
 * instance, що очікують consumer-и (`InvoicePublicView`, `getInvoiceStatus`).
 */
export async function loadPublicInvoiceView(
    businessSlug: string,
    accountSlug: string,
    invoiceSlug: string
): Promise<PublicInvoiceView | null> {
    const apiBase = process.env.API_INTERNAL_URL;
    if (!apiBase) {
        throw new Error(
            '❌ API_INTERNAL_URL is not defined (server-side env required for public page rendering)'
        );
    }
    const url = `${apiBase}/api/businesses/public/${encodeURIComponent(businessSlug)}/account/${encodeURIComponent(accountSlug)}/invoices/${encodeURIComponent(invoiceSlug)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) {
        throw new Error(
            `Public invoice fetch failed: ${res.status} ${res.statusText}`
        );
    }
    const json = (await res.json()) as { data: unknown };
    return PublicInvoiceSchema.parse(json.data);
}
