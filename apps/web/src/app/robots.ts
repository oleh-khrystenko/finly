import { headers } from 'next/headers';
import type { MetadataRoute } from 'next';

import { ENV } from '@/shared/config';
import { isPublicHost } from '@/shared/config/publicHosts';

const BASE_URL = ENV.NEXT_PUBLIC_BASE_URL;
const PAY_PUBLIC_URL = ENV.NEXT_PUBLIC_PAY_PUBLIC_URL;

/**
 * Host-aware robots. Один Next.js контейнер обслуговує два хости, а `robots.txt`
 * містить крапку → matcher `proxy.ts` його не переписує, тож обидва хости
 * доходять сюди. Правила мусять залежати від хоста, інакше публічний платіжний
 * хост посилався б на cabinet-sitemap (крос-хостова плутанина для краулера).
 *
 * - Публічний хост (`pay.finly.com.ua`): лишень opt-in платіжні сторінки;
 *   кабінет-роути на нього не резолвяться (Branch B → 404), інвойси noindex
 *   per-page. Sitemap — власний API-роут opt-in бізнесів.
 * - Cabinet-хост (`finly.com.ua`): публічний контент (лендінг, help, legal)
 *   краулиться; приватні зони й auth-флоу ховаються. Sitemap — cabinet.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
    const host = (await headers()).get('host');

    if (isPublicHost(host)) {
        return {
            rules: { userAgent: '*', allow: '/' },
            sitemap: `${PAY_PUBLIC_URL}/api/businesses/public/sitemap.xml`,
        };
    }

    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: ['/auth/', '/business', '/profile', '/billing'],
        },
        sitemap: `${BASE_URL}/sitemap.xml`,
    };
}
