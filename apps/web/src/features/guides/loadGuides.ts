import { z } from 'zod';
import {
    PublicGuideViewSchema,
    PublicGuidesTreeSchema,
    type PublicGuideView,
    type PublicGuidesTree,
} from '@finly/types';

/**
 * Sprint 28 — server-side fetch публічного контенту гайдів для Server
 * Components (сторінки, sitemap, OG-банер). Патерн `loadPublicAccountView`
 * (fail-fast API_INTERNAL_URL, Zod-parse на boundary), але з кешем: контент
 * рідко змінюється, тож відповіді живуть у Data Cache під тегом `guides` і
 * інвалідовуються on-demand після адмін-публікації (`revalidateTag`), з
 * фоновим інтервалом як страховкою, якщо тригер не спрацював.
 */

export const GUIDES_CACHE_TAG = 'guides';

/** Фонова страховка: 5 хв — стеля застарілості, якщо event-тригер загубився. */
const REVALIDATE_SECONDS = 300;

function apiBase(): string {
    const base = process.env.API_INTERNAL_URL;
    if (!base) {
        throw new Error(
            '❌ API_INTERNAL_URL is not defined (server-side env required for guides rendering)'
        );
    }
    return base;
}

const CACHE_OPTIONS: RequestInit = {
    next: { revalidate: REVALIDATE_SECONDS, tags: [GUIDES_CACHE_TAG] },
};

export async function loadGuidesTree(): Promise<PublicGuidesTree> {
    const res = await fetch(`${apiBase()}/api/guides/public`, CACHE_OPTIONS);
    if (!res.ok) {
        throw new Error(
            `Guides tree fetch failed: ${res.status} ${res.statusText}`
        );
    }
    const json = (await res.json()) as { data: unknown };
    return PublicGuidesTreeSchema.parse(json.data);
}

export async function loadGuideView(
    slug: string
): Promise<PublicGuideView | null> {
    const res = await fetch(
        `${apiBase()}/api/guides/public/${encodeURIComponent(slug)}`,
        CACHE_OPTIONS
    );
    if (res.status === 404) return null;
    if (!res.ok) {
        throw new Error(
            `Guide fetch failed: ${res.status} ${res.statusText}`
        );
    }
    const json = (await res.json()) as { data: unknown };
    return PublicGuideViewSchema.parse(json.data);
}

export async function loadGuideSlugs(): Promise<string[]> {
    const res = await fetch(
        `${apiBase()}/api/guides/public/sitemap/slugs`,
        CACHE_OPTIONS
    );
    if (!res.ok) {
        throw new Error(
            `Guide slugs fetch failed: ${res.status} ${res.statusText}`
        );
    }
    const json = (await res.json()) as { data: unknown };
    return z.array(z.string()).parse(json.data);
}

/**
 * Build-safe variants. `next build` runs with the API unreachable (CI has no
 * server, the web Docker image builds in isolation) and `API_INTERNAL_URL`
 * possibly unset, so a raw loader throw would abort the whole build during
 * static generation. These degrade to an empty result and let the ISR cache
 * (`revalidate` + on-demand `revalidateTag` after publish) populate real
 * content at runtime, exactly as the sitemap already does for slugs.
 */
export async function loadGuidesTreeSafe(): Promise<PublicGuidesTree> {
    try {
        return await loadGuidesTree();
    } catch (err) {
        console.error('guides: failed to load tree, degrading to empty', err);
        return [];
    }
}

export async function loadGuideSlugsSafe(): Promise<string[]> {
    try {
        return await loadGuideSlugs();
    } catch (err) {
        console.error('guides: failed to load slugs, degrading to empty', err);
        return [];
    }
}
