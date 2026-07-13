import Image from 'next/image';
import { ArrowLeft, Linkedin, Send, Globe, GraduationCap } from 'lucide-react';

import UiButton from '@/shared/ui/UiButton';
import UiLink from '@/shared/ui/UiLink';
import {
    getArticlesByAuthor,
    type HelpAuthor,
} from '@/entities/help-article';

import { HelpArticleCard } from './HelpArticleCard';

/** Label + icon for an external profile URL, matched by host. */
function describeLink(url: string): { label: string; Icon: typeof Globe } {
    let host = '';
    try {
        host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
        host = '';
    }

    if (host === 'linkedin.com') return { label: 'LinkedIn', Icon: Linkedin };
    if (host === 't.me') return { label: 'Telegram', Icon: Send };
    if (host === 'easyfin.in.ua') return { label: 'EasyFin', Icon: Globe };
    return { label: host || 'Сайт', Icon: Globe };
}

/**
 * Dedicated author profile (/avtor/[id]). The canonical home for the author
 * entity: full bio, credentials, external proof (sameAs) and the list of their
 * articles. Article author cards link here (internal) instead of straight out
 * to EasyFin, keeping authority on the site and reading as attribution, not ads.
 */
export function AuthorProfileView({ author }: { author: HelpAuthor }) {
    const articles = getArticlesByAuthor(author.id);
    const links = author.sameAs ?? [];

    return (
        <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 md:py-14 lg:px-8">
            <UiButton
                as="link"
                href="/help"
                variant="text"
                size="sm"
                IconLeft={<ArrowLeft className="size-4" />}
            >
                Довідка
            </UiButton>

            <header className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
                <span className="relative size-28 shrink-0 overflow-hidden rounded-2xl sm:size-32">
                    <Image
                        src={author.photo}
                        alt={author.name}
                        fill
                        sizes="128px"
                        className="object-cover object-top"
                        priority
                    />
                </span>

                <div className="min-w-0">
                    <h1 className="text-foreground text-2xl font-semibold tracking-tight md:text-3xl">
                        {author.name}
                    </h1>
                    <p className="text-primary mt-1 text-base font-medium">
                        {author.role}
                    </p>
                    {author.location && (
                        <p className="text-muted-foreground mt-1 text-sm">
                            {author.location}
                        </p>
                    )}

                    {links.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                            {links.map((url) => {
                                const { label, Icon } = describeLink(url);
                                return (
                                    <UiLink
                                        key={url}
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        variant="unstyled"
                                        className="border-border bg-card hover:border-primary/40 text-foreground inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors"
                                    >
                                        <Icon
                                            className="text-muted-foreground size-4"
                                            aria-hidden
                                        />
                                        {label}
                                    </UiLink>
                                );
                            })}
                        </div>
                    )}
                </div>
            </header>

            <p className="text-foreground/90 mt-8 text-base leading-relaxed">
                {author.longBio ?? author.bio}
            </p>

            {author.knowsAbout && author.knowsAbout.length > 0 && (
                <div className="mt-6 flex flex-wrap gap-2">
                    {author.knowsAbout.map((topic) => (
                        <span
                            key={topic}
                            className="border-border bg-muted/40 text-muted-foreground rounded-full border px-3 py-1 text-sm"
                        >
                            {topic}
                        </span>
                    ))}
                </div>
            )}

            {author.alumniOf && (
                <p className="text-muted-foreground mt-6 flex items-center gap-2 text-sm">
                    <GraduationCap className="size-4 shrink-0" aria-hidden />
                    {author.alumniOf}
                </p>
            )}

            {articles.length > 0 && (
                <section className="mt-12" aria-labelledby="author-articles">
                    <h2
                        id="author-articles"
                        className="text-foreground text-lg font-semibold tracking-tight"
                    >
                        Статті автора
                    </h2>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {articles.map((article) => (
                            <HelpArticleCard
                                key={article.slug}
                                article={article}
                            />
                        ))}
                    </div>
                </section>
            )}
        </main>
    );
}
