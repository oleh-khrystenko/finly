import { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
    getAllArticleSlugs,
    getArticleBySlug,
} from '@/entities/help-article';
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
            title: `${article.title} — Довідка Finly`,
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

    return <HelpArticleView article={article} />;
}
