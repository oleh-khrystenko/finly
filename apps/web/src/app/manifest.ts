import type { MetadataRoute } from 'next';

import { THEME_BACKGROUND } from '@/shared/styles/themeColors';

/**
 * Web app manifest для встановлюваності і брендингу. Кольори теми — світлий
 * paper-фон `:root --background` (літерал через `THEME_BACKGROUND`, бо манифест
 * читається до CSS); іконки растрові з паддингом під maskable safe-zone.
 */
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'Finly — платіжні QR-коди та рахунки для ФОП',
        short_name: 'Finly',
        description:
            'Платіжні сторінки, рахунки та QR-коди за стандартом НБУ для українських ФОП і бухгалтерів.',
        lang: 'uk',
        start_url: '/',
        display: 'standalone',
        background_color: THEME_BACKGROUND.light,
        theme_color: THEME_BACKGROUND.light,
        icons: [
            {
                src: '/icons/icon-192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any',
            },
            {
                src: '/icons/icon-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any',
            },
            {
                src: '/icons/icon-maskable-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable',
            },
        ],
    };
}
