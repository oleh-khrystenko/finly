import { Injectable, Logger } from '@nestjs/common';
import { JWT } from 'google-auth-library';

import { ENV } from '../../config/env';

const SEARCH_ANALYTICS_URL = (site: string): string =>
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
        site
    )}/searchAnalytics/query`;

interface SearchAnalyticsRow {
    keys: string[];
    clicks: number;
}

interface SearchAnalyticsResponse {
    rows?: SearchAnalyticsRow[];
}

/** URL без кінцевого слеша — щоб зіставлення сторінки з гайдом не залежало від нього. */
export function normalizeUrl(url: string): string {
    return url.replace(/\/+$/, '');
}

/**
 * Тонкий клієнт Google Search Console (Search Analytics). Автентифікація —
 * сервіс-акаунт (JWT-підпис приватним ключем), scope лише на читання. Єдина
 * операція: кліки з органічного пошуку в розрізі сторінок за період.
 */
@Injectable()
export class GoogleSearchConsoleClient {
    private readonly logger = new Logger(GoogleSearchConsoleClient.name);
    private readonly jwt = new JWT({
        email: ENV.GSC_CLIENT_EMAIL,
        key: ENV.GSC_PRIVATE_KEY,
        scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });

    /**
     * Кліки за сторінками у вікні [startDate, endDate] (YYYY-MM-DD).
     * Повертає мапу нормалізований-URL → кліки.
     */
    async fetchPageClicks(
        startDate: string,
        endDate: string
    ): Promise<Map<string, number>> {
        const res = await this.jwt.request<SearchAnalyticsResponse>({
            url: SEARCH_ANALYTICS_URL(ENV.GSC_SITE_URL),
            method: 'POST',
            data: {
                startDate,
                endDate,
                dimensions: ['page'],
                type: 'web',
                rowLimit: 25000,
            },
        });

        const clicksByUrl = new Map<string, number>();
        for (const row of res.data.rows ?? []) {
            const pageUrl = row.keys[0];
            if (pageUrl) {
                clicksByUrl.set(normalizeUrl(pageUrl), Math.round(row.clicks));
            }
        }
        this.logger.log(
            `GSC: ${clicksByUrl.size} сторінок за ${startDate}…${endDate}`
        );
        return clicksByUrl;
    }
}
