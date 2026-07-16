import type { MetadataRoute } from 'next';

import { getAllArticleSlugs, getAllAuthors } from '@/entities/help-article';
import { loadGuideSlugsSafe } from '@/features/guides';
import { ENV } from '@/shared/config';

const BASE_URL = ENV.NEXT_PUBLIC_BASE_URL;

/**
 * Sitemap for the cabinet host (finly.com.ua). Lists the public, indexable
 * pages: landing, the help-center and the guides section. Help URLs come from
 * the compile-time article source; guide URLs come from the API (published
 * only), so unpublished drafts never leak into the sitemap.
 *
 * Legal pages stay out while they carry `noindex` pending lawyer review.
 */

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const helpArticles: MetadataRoute.Sitemap = getAllArticleSlugs().map(
        (slug) => ({
            url: `${BASE_URL}/help/${slug}`,
            changeFrequency: 'monthly',
            priority: 0.6,
        })
    );

    const guideSlugs = await loadGuideSlugsSafe();
    // Порожній розділ (нуль опублікованих гайдів) не потрапляє в sitemap: ні
    // кореневий `/guides`, ні статті. Інакше «гайди скоро зʼявляться» осіла б
    // в індексі як тонка сторінка (Sprint 28 §UI).
    const guides: MetadataRoute.Sitemap =
        guideSlugs.length > 0
            ? [
                  {
                      url: `${BASE_URL}/guides`,
                      changeFrequency: 'monthly',
                      priority: 0.7,
                  },
                  ...guideSlugs.map((slug) => ({
                      url: `${BASE_URL}/guides/${slug}`,
                      changeFrequency: 'monthly' as const,
                      priority: 0.6,
                  })),
              ]
            : [];

    const authors: MetadataRoute.Sitemap = getAllAuthors().map((author) => ({
        url: `${BASE_URL}/avtor/${author.id}`,
        changeFrequency: 'monthly',
        priority: 0.5,
    }));

    return [
        { url: BASE_URL, changeFrequency: 'monthly', priority: 1 },
        { url: `${BASE_URL}/help`, changeFrequency: 'monthly', priority: 0.7 },
        ...helpArticles,
        ...guides,
        ...authors,
    ];
}
