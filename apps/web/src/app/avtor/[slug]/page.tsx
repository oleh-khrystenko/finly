import { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getAllAuthors, getAuthorById } from '@/entities/help-article';
import { ENV } from '@/shared/config';
import { JsonLd } from '@/shared/seo/JsonLd';
import { AuthorProfileView } from '@/features/help-center';
import { fetchMetadata } from '@/shared/seo/metadata';

export function generateStaticParams() {
    return getAllAuthors().map((author) => ({ slug: author.id }));
}

export async function generateMetadata({
    params,
}: {
    params: Promise<{ slug: string }>;
}): Promise<Metadata> {
    const { slug } = await params;
    const author = getAuthorById(slug);
    if (!author) return {};

    return fetchMetadata({
        page: 'author',
        href: `avtor/${slug}`,
        meta: {
            title: `${author.name}: ${author.role} | Finly`,
            description: author.bio,
        },
    });
}

export default async function AuthorPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const author = getAuthorById(slug);
    if (!author) notFound();

    const baseUrl = ENV.NEXT_PUBLIC_BASE_URL.replace(/\/$/, '');
    const profileUrl = `${baseUrl}/avtor/${author.id}`;

    return (
        <>
            <JsonLd
                data={{
                    '@context': 'https://schema.org',
                    '@type': 'ProfilePage',
                    mainEntity: {
                        '@type': 'Person',
                        '@id': `${profileUrl}#person`,
                        name: author.name,
                        jobTitle: author.role,
                        description: author.longBio ?? author.bio,
                        url: profileUrl,
                        image: `${baseUrl}${author.photo}`,
                        ...(author.location && {
                            address: {
                                '@type': 'PostalAddress',
                                addressLocality: author.location,
                            },
                        }),
                        ...(author.worksFor && {
                            worksFor: {
                                '@type': 'Organization',
                                name: author.worksFor.name,
                                url: author.worksFor.url,
                            },
                        }),
                        ...(author.alumniOf && {
                            alumniOf: {
                                '@type': 'EducationalOrganization',
                                name: author.alumniOf,
                            },
                        }),
                        ...(author.knowsAbout?.length && {
                            knowsAbout: author.knowsAbout,
                        }),
                        ...(author.sameAs?.length && { sameAs: author.sameAs }),
                    },
                }}
            />
            <AuthorProfileView author={author} />
        </>
    );
}
