import { ArrowRight, BookOpen } from 'lucide-react';

import UiLink from '@/shared/ui/UiLink';
import type { PublicGuideCard, PublicGuidesTree } from '@/entities/guide';

import { GuideArticleCard } from './GuideArticleCard';

/**
 * Guides home: an informational hub, separate from /help (support intent) and
 * the landing (brand intent). Each pillar is the primary block — a prominent
 * card that spreads link equity to its cluster grid below.
 */
export function GuidesHome({ tree }: { tree: PublicGuidesTree }) {
    return (
        <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 md:py-16 lg:px-8">
            <header className="text-center">
                <h1 className="text-foreground text-3xl font-semibold tracking-tight md:text-4xl">
                    Гайди Finly
                </h1>
                <p className="text-muted-foreground mx-auto mt-3 max-w-xl text-base leading-relaxed">
                    Практичні гайди про те, як приймати оплату, виставляти
                    рахунки і працювати з платіжними QR-кодами за стандартом НБУ.
                </p>
            </header>

            {tree.length === 0 ? (
                <div className="border-border bg-muted/40 mx-auto mt-12 flex max-w-md flex-col items-center gap-3 rounded-xl border p-8 text-center">
                    <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
                        <BookOpen className="size-5" aria-hidden />
                    </span>
                    <p className="text-foreground text-sm font-medium">
                        Гайдів поки немає
                    </p>
                    <p className="text-muted-foreground text-sm">
                        Ми готуємо перші матеріали. Загляньте трохи пізніше.
                    </p>
                </div>
            ) : (
                <div className="mt-12 space-y-12 md:mt-14">
                    {tree.map(({ pillar, clusters }) => (
                        <section
                            key={pillar.slug}
                            aria-labelledby={`pillar-${pillar.slug}`}
                        >
                            <PillarCard
                                pillar={pillar}
                                headingId={`pillar-${pillar.slug}`}
                            />

                            {clusters.length > 0 && (
                                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                    {clusters.map((guide) => (
                                        <GuideArticleCard
                                            key={guide.slug}
                                            guide={guide}
                                        />
                                    ))}
                                </div>
                            )}
                        </section>
                    ))}
                </div>
            )}
        </main>
    );
}

function PillarCard({
    pillar,
    headingId,
}: {
    pillar: PublicGuideCard;
    headingId: string;
}) {
    return (
        <UiLink
            as="link"
            href={`/guides/${pillar.slug}`}
            variant="unstyled"
            className="group border-border bg-card hover:border-primary/40 block rounded-2xl border p-6 transition-colors sm:p-8"
        >
            <p className="text-primary text-xs font-semibold tracking-widest uppercase">
                Основний гайд
            </p>
            <div className="mt-2 flex items-start justify-between gap-4">
                <h2
                    id={headingId}
                    className="text-foreground text-xl font-semibold tracking-tight md:text-2xl"
                >
                    {pillar.title}
                </h2>
                <ArrowRight className="text-muted-foreground group-hover:text-primary mt-1 size-5 shrink-0 transition-colors" />
            </div>
            <p className="text-muted-foreground mt-2 max-w-2xl text-base leading-relaxed">
                {pillar.description}
            </p>
            <span className="text-primary mt-4 inline-flex items-center gap-1 text-sm font-medium">
                Читати гайд
                <ArrowRight className="size-4" aria-hidden />
            </span>
        </UiLink>
    );
}
