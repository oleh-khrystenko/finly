import { PublicBusinessSchema, type PublicBusinessView } from '@finly/types';

/**
 * Sprint 9 §SP-4 — server-side fetch root-вивіски бізнесу для Server
 * Component `app/host-pay/[slug]/page.tsx`.
 *
 * **`cache: 'no-store'` (Sprint 9 change vs Sprint 3 `revalidate: 60`).**
 * Server Component робить branching на `accounts.length` (0/1/2+):
 * `=== 1 → redirect()` — стан умовний. Якщо ФОП додав 2-й рахунок, але
 * Next.js ISR віддав закешований 1-Account snapshot → клієнт отримає 307
 * на застарілий accountSlug замість списку. UAT ACC-2 явно перевіряє цей
 * сценарій (`додав 2-й рахунок → одразу побачив список з 2 карток у тій
 * самій сесії`). Без `cache: 'no-store'` test не пройде.
 *
 * Edge-level cache controlled через `Cache-Control: no-store` header, що
 * middleware Branch A1 ставить на rewrite-response (defense-in-depth для
 * CDN/proxy-шару — деталі у `middleware.ts` коментарі Branch A1).
 *
 * **Zod-parse на boundary** — API JSON містить `accounts` array;
 * `PublicBusinessSchema` strip-ить leak-кандидати і валідує shape.
 *
 * **Чому `API_INTERNAL_URL`, не `NEXT_PUBLIC_API_URL`** — server-side у
 * docker-compose рендер на `http://api:4000` (internal network); public
 * `/api` — це Next.js rewrites для client-side. Server Component викликає
 * API напряму без proxy hop-у.
 */
export async function loadPublicView(
    slug: string
): Promise<PublicBusinessView | null> {
    const apiBase = process.env.API_INTERNAL_URL;
    if (!apiBase) {
        throw new Error(
            '❌ API_INTERNAL_URL is not defined (server-side env required for public page rendering)'
        );
    }
    const url = `${apiBase}/api/businesses/public/${encodeURIComponent(slug)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) {
        throw new Error(
            `Public business fetch failed: ${res.status} ${res.statusText}`
        );
    }
    const json = (await res.json()) as { data: unknown };
    return PublicBusinessSchema.parse(json.data);
}
