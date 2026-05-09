import { PublicInvoiceSchema, type PublicInvoiceView } from '@finly/types';

/**
 * Sprint 4 §4.7 — server-side fetch публічного view інвойсу для Server
 * Component на `app/host-pay/[slug]/[invoiceSlug]/page.tsx`.
 *
 * Server-only native fetch до `API_INTERNAL_URL`. На відміну від Sprint 3
 * `loadPublicView` (бізнес — vanity вивіска з ISR `revalidate: 60`), invoice —
 * mutable payment-команда: `cache: 'no-store'` гарантує fresh fetch на кожен
 * request. Stale-кеш ламає payment correctness (видалений рахунок ще видно,
 * стара сума показується після редагування). CDN-relief, якщо знадобиться, —
 * через ETag, не через time-based cache window.
 *
 * **Zod-parse на boundary** (Sprint 4 review fix): API JSON містить дати як
 * ISO-strings; `PublicInvoiceSchema` (`z.coerce.date()`) нормалізує `validUntil`
 * у `Date` instance, що очікують consumer-и (`InvoicePublicView`,
 * `getInvoiceStatus`).
 */
export async function loadPublicInvoiceView(
    businessSlug: string,
    invoiceSlug: string
): Promise<PublicInvoiceView | null> {
    const apiBase = process.env.API_INTERNAL_URL;
    if (!apiBase) {
        throw new Error(
            '❌ API_INTERNAL_URL is not defined (server-side env required for public page rendering)'
        );
    }
    const url = `${apiBase}/api/businesses/public/${encodeURIComponent(businessSlug)}/invoices/${encodeURIComponent(invoiceSlug)}`;
    // `cache: 'no-store'` — invoice mutable (Sprint 4 review fix). Stale-кеш
    // ламає payment correctness: видалений рахунок ще видно клієнту, або
    // показується стара сума після редагування. CDN-relief, якщо знадобиться,
    // — через ETag, не через time-based ISR.
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
