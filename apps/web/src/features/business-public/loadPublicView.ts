import type { PublicBusinessView } from '@finly/types';

/**
 * Sprint 3 §3.3 + §3.9 — server-side fetch публічного view бізнесу для
 * Server Component-а на `app/host-pay/[slug]/page.tsx`.
 *
 * **Чому НЕ через `apiClient`** (axios з in-memory token + refresh dedupe):
 * apiClient — client-only state, недоступний у Server Components. Public
 * endpoint без auth (немає `Authorization`/cookie), тож native `fetch` —
 * найпростіший і консистентний з Next.js ISR cache (`next.revalidate`).
 *
 * **Чому `API_INTERNAL_URL`, не `NEXT_PUBLIC_API_URL`:** server-side у
 * docker-compose рендер на `http://api:4000` (internal network); public
 * URL `/api` — це Next.js rewrites для client-side. Server Component
 * викликає API напряму без proxy hop-у.
 *
 * **Cache:** `revalidate: 60` (Sprint 3 рішення F4) — узгоджується з
 * `Cache-Control: max-age=3600, stale-while-revalidate=86400` на API-боці
 * (60s тут агресивніший — публікація змін ФОП-а видна швидше).
 */
export async function loadPublicView(
    slug: string,
): Promise<PublicBusinessView | null> {
    const apiBase = process.env.API_INTERNAL_URL;
    if (!apiBase) {
        throw new Error(
            '❌ API_INTERNAL_URL is not defined (server-side env required for public page rendering)',
        );
    }
    const url = `${apiBase}/api/businesses/public/${encodeURIComponent(slug)}`;
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (res.status === 404) return null;
    if (!res.ok) {
        throw new Error(
            `Public business fetch failed: ${res.status} ${res.statusText}`,
        );
    }
    const json = (await res.json()) as { data: PublicBusinessView };
    return json.data;
}
