import { ChevronRight, ArrowLeft } from 'lucide-react';

import UiLink from '@/shared/ui/UiLink';
import UiButton from '@/shared/ui/UiButton';
import { AuthorCard } from '@/entities/author';
import type { PublicGuide, PublicGuideCard } from '@/entities/guide';

import { GuideArticleCard } from './GuideArticleCard';
import { GuideBlocks } from './GuideBlocks';
import { GuideFaq } from './GuideFaq';
import { GuideToc } from './GuideToc';

// dateModified — date-only ISO (парситься як UTC-північ). Тримаємо київський час,
// як і решта дат у проєкті, інакше на білд-машині позаду UTC дата зʼїхала б на день.
const DATE_FMT = new Intl.DateTimeFormat('uk-UA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Kyiv',
});

interface GuideArticleViewProps {
    guide: PublicGuide;
    /** Pillar цього cluster-а (breadcrumb); null для pillar-статті. */
    pillar: PublicGuideCard | null;
    related: PublicGuideCard[];
}

export function GuideArticleView({
    guide,
    pillar,
    related,
}: GuideArticleViewProps) {
    const updated = guide.dateModified
        ? DATE_FMT.format(new Date(guide.dateModified))
        : null;
    // Pillar page links its clusters; a cluster page links back to its pillar.
    const relatedHeading = guide.pillarSlug
        ? 'Читайте також'
        : 'У цьому розділі';

    return (
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-14 lg:px-8">
            <article className="min-w-0">
                <nav
                    aria-label="Хлібні крихти"
                    className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm"
                >
                    <UiLink as="link" href="/guides" variant="muted">
                        Гайди
                    </UiLink>
                    {pillar && (
                        <>
                            <ChevronRight
                                className="size-3.5"
                                aria-hidden="true"
                            />
                            <UiLink
                                as="link"
                                href={`/guides/${pillar.slug}`}
                                variant="muted"
                            >
                                {pillar.title}
                            </UiLink>
                        </>
                    )}
                </nav>

                <h1 className="text-foreground mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
                    {guide.title}
                </h1>
                <p className="text-muted-foreground mt-2 text-base leading-relaxed">
                    {guide.description}
                </p>
                {updated && (
                    <p className="text-muted-foreground mt-3 text-sm">
                        Оновлено {updated}
                    </p>
                )}

                <GuideToc blocks={guide.blocks} />

                <GuideBlocks blocks={guide.blocks} />

                <GuideFaq faq={guide.faq} />

                <AuthorCard authorId={guide.authorId} />

                {related.length > 0 && (
                    <section
                        className="mt-10"
                        aria-labelledby="related-heading"
                    >
                        <h2
                            id="related-heading"
                            className="text-foreground text-base font-semibold tracking-tight"
                        >
                            {relatedHeading}
                        </h2>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            {related.map((item) => (
                                <GuideArticleCard
                                    key={item.slug}
                                    guide={item}
                                />
                            ))}
                        </div>
                    </section>
                )}

                <div className="mt-10">
                    <UiButton
                        as="link"
                        href="/guides"
                        variant="text"
                        size="sm"
                        IconLeft={<ArrowLeft className="size-4" />}
                    >
                        Усі гайди
                    </UiButton>
                </div>
            </article>
        </main>
    );
}
