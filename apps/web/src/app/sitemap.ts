import type { MetadataRoute } from 'next';

import { getAllArticleSlugs, getAllAuthors } from '@/entities/help-article';
import { ENV } from '@/shared/config';

const BASE_URL = ENV.NEXT_PUBLIC_BASE_URL;

/**
 * Sitemap for the cabinet host (finly.com.ua). Lists the public, indexable
 * pages: landing and the whole help-center. Help URLs are derived from the
 * same article source of truth (`getAllArticleSlugs`), so a new article is
 * picked up automatically and the sitemap never drifts from the content.
 *
 * Legal pages stay out while they carry `noindex` pending lawyer review.
 */
export default function sitemap(): MetadataRoute.Sitemap {
    const helpArticles: MetadataRoute.Sitemap = getAllArticleSlugs().map(
        (slug) => ({
            url: `${BASE_URL}/help/${slug}`,
            changeFrequency: 'monthly',
            priority: 0.6,
        })
    );

    const authors: MetadataRoute.Sitemap = getAllAuthors().map((author) => ({
        url: `${BASE_URL}/avtor/${author.id}`,
        changeFrequency: 'monthly',
        priority: 0.5,
    }));

    return [
        { url: BASE_URL, changeFrequency: 'monthly', priority: 1 },
        { url: `${BASE_URL}/help`, changeFrequency: 'monthly', priority: 0.7 },
        ...helpArticles,
        ...authors,
    ];
}
