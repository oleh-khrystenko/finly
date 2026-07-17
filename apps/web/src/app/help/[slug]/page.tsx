import { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
    getAllArticleSlugs,
    getArticleBySlug,
    getAuthorById,
    getCategoryById,
} from '@/entities/help-article';
import { ENV } from '@/shared/config';
import { JsonLd } from '@/shared/seo/JsonLd';
import { HelpArticleView } from '@/features/help-center';
import { fetchMetadata } from '@/shared/seo/metadata';

export function generateStaticParams() {
    return getAllArticleSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
    params,
}: {
    params: Promise<{ slug: string }>;
}): Promise<Metadata> {
    const { slug } = await params;
    const article = getArticleBySlug(slug);
    if (!article) return {};

    return fetchMetadata({
        page: 'help-article',
        href: `help/${slug}`,
        meta: {
            title: `${article.title} | Довідка Finly`,
            description: article.description,
            // Opt out of the shared banner; opengraph-image.tsx renders a
            // per-article banner with the title (Sprint 24).
            ogImage: null,
        },
    });
}

export default async function HelpArticlePage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const article = getArticleBySlug(slug);
    if (!article) notFound();
    const category = getCategoryById(article.categoryId);
    const author = getAuthorById(article.authorId);
    const baseUrl = ENV.NEXT_PUBLIC_BASE_URL.replace(/\/$/, '');
    const articleUrl = `${baseUrl}/help/${article.slug}`;
    // Per-article банер із opengraph-image.tsx (Next віддає його як .png за цим
    // route). Той самий образ підсилює Article-розмітку як recommended `image`.
    const articleImage = `${articleUrl}/opengraph-image.png`;

    const authorNode = author
        ? {
              '@type': 'Person',
              '@id': `${baseUrl}/avtor/${author.id}#person`,
              name: author.name,
              jobTitle: author.role,
              url: `${baseUrl}/avtor/${author.id}`,
              ...(author.worksFor && {
                  worksFor: {
                      '@type': 'Organization',
                      name: author.worksFor.name,
                      url: author.worksFor.url,
                  },
              }),
              ...(author.sameAs?.length && { sameAs: author.sameAs }),
          }
        : undefined;

    return (
        <>
            <JsonLd
                data={{
                    '@context': 'https://schema.org',
                    '@graph': [
                        {
                            '@type': 'BreadcrumbList',
                            itemListElement: [
                                {
                                    '@type': 'ListItem',
                                    position: 1,
                                    name: 'Довідка',
                                    item: `${baseUrl}/help`,
                                },
                                ...(category
                                    ? [
                                          {
                                              '@type': 'ListItem',
                                              position: 2,
                                              name: category.title,
                                              item: `${baseUrl}/help#cat-${category.id}`,
                                          },
                                      ]
                                    : []),
                                {
                                    '@type': 'ListItem',
                                    position: category ? 3 : 2,
                                    name: article.title,
                                    item: articleUrl,
                                },
                            ],
                        },
                        {
                            '@type': 'Article',
                            headline: article.title,
                            description: article.description,
                            image: articleImage,
                            inLanguage: 'uk-UA',
                            url: articleUrl,
                            mainEntityOfPage: articleUrl,
                            datePublished: article.datePublished,
                            dateModified: article.dateModified,
                            ...(authorNode && { author: authorNode }),
                            isPartOf: {
                                '@type': 'WebSite',
                                name: 'Finly',
                                url: baseUrl,
                            },
                            publisher: {
                                '@type': 'Organization',
                                name: 'Finly',
                                url: baseUrl,
                                logo: `${baseUrl}/logo/mark-512.png`,
                            },
                        },
                    ],
                }}
            />
            <HelpArticleView article={article} />
        </>
    );
}
