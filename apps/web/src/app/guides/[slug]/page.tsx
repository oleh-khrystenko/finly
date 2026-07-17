import { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getAuthorById } from '@/entities/guide';
import { ENV } from '@/shared/config';
import { JsonLd } from '@/shared/seo/JsonLd';
import {
    GuideArticleView,
    loadGuideSlugsSafe,
    loadGuideView,
} from '@/features/guides';
import { fetchMetadata } from '@/shared/seo/metadata';

export async function generateStaticParams() {
    // Safe: on build the API is unreachable; return no params and let unknown
    // slugs render on-demand (dynamicParams defaults to true).
    const slugs = await loadGuideSlugsSafe();
    return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
    params,
}: {
    params: Promise<{ slug: string }>;
}): Promise<Metadata> {
    const { slug } = await params;
    const view = await loadGuideView(slug);
    if (!view) return {};

    return fetchMetadata({
        page: 'guide-article',
        href: `guides/${slug}`,
        meta: {
            title: `${view.guide.title} | Finly`,
            description: view.guide.description,
            // Opt out of the shared banner; opengraph-image.tsx renders a
            // per-article banner with the title.
            ogImage: null,
        },
    });
}

export default async function GuideArticlePage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const view = await loadGuideView(slug);
    if (!view) notFound();
    const { guide, pillar, related } = view;
    const author = getAuthorById(guide.authorId);
    const baseUrl = ENV.NEXT_PUBLIC_BASE_URL.replace(/\/$/, '');
    const guideUrl = `${baseUrl}/guides/${guide.slug}`;
    // Per-article банер із opengraph-image.tsx (Next віддає його як .png за цим
    // route). Той самий образ підсилює Article-розмітку як recommended `image`.
    const guideImage = `${guideUrl}/opengraph-image.png`;

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

    const breadcrumb = [
        {
            '@type': 'ListItem',
            position: 1,
            name: 'Гайди',
            item: `${baseUrl}/guides`,
        },
        ...(pillar
            ? [
                  {
                      '@type': 'ListItem',
                      position: 2,
                      name: pillar.title,
                      item: `${baseUrl}/guides/${pillar.slug}`,
                  },
              ]
            : []),
        {
            '@type': 'ListItem',
            position: pillar ? 3 : 2,
            name: guide.title,
            item: guideUrl,
        },
    ];

    return (
        <>
            <JsonLd
                data={{
                    '@context': 'https://schema.org',
                    '@graph': [
                        {
                            '@type': 'BreadcrumbList',
                            itemListElement: breadcrumb,
                        },
                        {
                            '@type': 'Article',
                            headline: guide.title,
                            description: guide.description,
                            image: guideImage,
                            inLanguage: 'uk-UA',
                            url: guideUrl,
                            mainEntityOfPage: guideUrl,
                            ...(guide.datePublished && {
                                datePublished: guide.datePublished,
                            }),
                            ...(guide.dateModified && {
                                dateModified: guide.dateModified,
                            }),
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
                        // FAQ markup stays for AI search / entity parsers (AEO):
                        // Google dropped FAQ rich results in May 2026.
                        ...(guide.faq.length
                            ? [
                                  {
                                      '@type': 'FAQPage',
                                      mainEntity: guide.faq.map((item) => ({
                                          '@type': 'Question',
                                          name: item.question,
                                          acceptedAnswer: {
                                              '@type': 'Answer',
                                              text: item.answer,
                                          },
                                      })),
                                  },
                              ]
                            : []),
                    ],
                }}
            />
            <GuideArticleView
                guide={guide}
                pillar={pillar}
                related={related}
            />
        </>
    );
}
