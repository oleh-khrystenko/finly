import {
    PublicAccountViewSchema,
    type PublicAccountView,
} from '@finly/types';

/**
 * Sprint 9 §SP-4 — server-side fetch публічного view per-account вивіски для
 * Server Component `app/host-pay/[slug]/[accountSlug]/page.tsx`.
 *
 * **`cache: 'no-store'`** — account-vanity-view stable; зміни редагування
 * (name, invoiceSlugPresetDefault) мають бути видимі клієнту негайно після
 * того як ФОП оновив дані. ISR-вікно 60s (Sprint 3 baseline для business-
 * вивіски) тут не виправдано — payment-link на застарілий IBAN мав би
 * payment-impact, а UI-state (name) має cabinet→public consistency-вимогу.
 *
 * **Zod-parse на boundary** — API JSON містить `nbuLinks` як рядки;
 * `PublicAccountViewSchema` strip-ить leak-кандидати (whitelist 6 полів +
 * nested `business` + `nbuLinks`).
 */
export async function loadPublicAccountView(
    businessSlug: string,
    accountSlug: string
): Promise<PublicAccountView | null> {
    const apiBase = process.env.API_INTERNAL_URL;
    if (!apiBase) {
        throw new Error(
            '❌ API_INTERNAL_URL is not defined (server-side env required for public page rendering)'
        );
    }
    const url = `${apiBase}/api/businesses/public/${encodeURIComponent(businessSlug)}/account/${encodeURIComponent(accountSlug)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) {
        throw new Error(
            `Public account fetch failed: ${res.status} ${res.statusText}`
        );
    }
    const json = (await res.json()) as { data: unknown };
    return PublicAccountViewSchema.parse(json.data);
}
