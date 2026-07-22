import { cache } from 'react';

import { PublicCatalogSchema, type PublicCatalogView } from '@finly/types';

/**
 * Sprint 29 — server-side fetch публічного каталогу для головної pay-хоста
 * (`app/host-pay/page.tsx`). Дзеркалить `loadPublicView`: прямий виклик API
 * через `API_INTERNAL_URL` (docker internal network), Zod-parse на boundary.
 *
 * `cache: 'no-store'` — каталог revocable: зняття видимості чи згасання Brand
 * мусять гаснути одразу, без ISR-затримки (той самий контракт, що public-вивіска).
 */
export async function loadCatalog(): Promise<PublicCatalogView> {
    const apiBase = process.env.API_INTERNAL_URL;
    if (!apiBase) {
        throw new Error(
            '❌ API_INTERNAL_URL is not defined (server-side env required for catalog rendering)'
        );
    }
    const res = await fetch(`${apiBase}/api/businesses/public/catalog`, {
        cache: 'no-store',
    });
    if (!res.ok) {
        throw new Error(
            `Public catalog fetch failed: ${res.status} ${res.statusText}`
        );
    }
    const json = (await res.json()) as { data: unknown };
    return PublicCatalogSchema.parse(json.data);
}

/**
 * Каталог для кореня pay-хоста, який не має права впасти: до Sprint 29 корінь
 * був статичним пояснювачем і від API не залежав, тож недоступний бекенд не
 * повинен перетворювати його на сторінку помилки. На збої віддаємо порожній
 * каталог, і сторінка показує той самий пояснювач, що при порожньому каталозі
 * (прецедент — `loadGuideSlugsSafe` у `app/sitemap.ts`).
 *
 * Обгорнуто в React `cache`: `generateMetadata` і сам page-handler мусять бачити
 * ОДИН стан каталогу (порожній каталог керує ще й `robots.index`), а без дедуплікації
 * це були б два незалежні `no-store`-запити, здатні розійтися між собою.
 */
export const loadCatalogSafe = cache(async (): Promise<PublicCatalogView> => {
    try {
        return await loadCatalog();
    } catch (err) {
        console.error('[catalog] Failed to load public catalog:', err);
        return { sections: [] };
    }
});
