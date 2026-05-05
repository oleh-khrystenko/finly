import type { PublicInvoiceView } from '@finly/types';

/**
 * Sprint 4 §4.7 — server-side fetch публічного view інвойсу для Server
 * Component на `app/host-pay/[slug]/[invoiceSlug]/page.tsx`.
 *
 * **Той самий patern, що `loadPublicView` Sprint 3** (server-only native
 * fetch до `API_INTERNAL_URL`; ISR `revalidate: 60`).
 */
export async function loadPublicInvoiceView(
    businessSlug: string,
    invoiceSlug: string,
): Promise<PublicInvoiceView | null> {
    const apiBase = process.env.API_INTERNAL_URL;
    if (!apiBase) {
        throw new Error(
            '❌ API_INTERNAL_URL is not defined (server-side env required for public page rendering)',
        );
    }
    const url = `${apiBase}/api/businesses/public/${encodeURIComponent(businessSlug)}/invoices/${encodeURIComponent(invoiceSlug)}`;
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (res.status === 404) return null;
    if (!res.ok) {
        throw new Error(
            `Public invoice fetch failed: ${res.status} ${res.statusText}`,
        );
    }
    const json = (await res.json()) as { data: PublicInvoiceView };
    return json.data;
}
