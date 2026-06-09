import type { MetadataRoute } from 'next';

import { ENV } from '@/shared/config';

const BASE_URL = ENV.NEXT_PUBLIC_BASE_URL;

/**
 * Robots policy. Public content (landing, help, legal) is crawlable; the
 * authenticated cabinet sections and auth flows are kept out of the index.
 * Per-page `noindex` (e.g. business pages with SEO disabled) is still honoured
 * separately via route metadata, so this only blocks the always-private areas.
 */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: ['/auth/', '/business', '/profile', '/billing'],
        },
        sitemap: `${BASE_URL}/sitemap.xml`,
    };
}
