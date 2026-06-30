import { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
    getAllArticleSlugs,
    getArticleBySlug,
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
    const baseUrl = ENV.NEXT_PUBLIC_BASE_URL.replace(/\/$/, '');
    const articleUrl = `${baseUrl}/help/${article.slug}`;

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
                            inLanguage: 'uk-UA',
                            url: articleUrl,
                            mainEntityOfPage: articleUrl,
                            isPartOf: {
                                '@type': 'WebSite',
                                name: 'Finly',
                                url: baseUrl,
                            },
                            publisher: {
                                '@type': 'Organization',
                                name: 'Finly',
                                url: baseUrl,
                                logo: `${baseUrl}/logo/light-theme.svg`,
                            },
                        },
                    ],
                }}
            />
            <HelpArticleView article={article} />
        </>
    );
}
