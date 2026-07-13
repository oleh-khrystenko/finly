import Image from 'next/image';
import { ArrowRight } from 'lucide-react';

import UiLink from '@/shared/ui/UiLink';
import { getAuthorById, type HelpArticle } from '@/entities/help-article';

/**
 * "Про автора" card at the end of the article. On support docs a person belongs
 * at the bottom as an attribution/bio block, not as a top byline (which reads
 * ambiguously on a help page). This is also the classic E-E-A-T placement and
 * mirrors the Person node in the page structured data.
 *
 * The "profile" action sits top-right, in the header row with the section
 * label ("section heading + action" pattern), not buried under the role.
 */
export function HelpAuthorCard({ article }: { article: HelpArticle }) {
    const author = getAuthorById(article.authorId);
    if (!author) return null;

    return (
        <section
            className="border-border bg-muted/40 mt-10 rounded-xl border p-5 sm:p-6"
            aria-labelledby="author-heading"
        >
            <div className="flex items-center justify-between gap-4">
                <h2
                    id="author-heading"
                    className="text-muted-foreground text-xs font-medium tracking-widest uppercase"
                >
                    Про автора
                </h2>
                <UiLink
                    as="link"
                    href={`/avtor/${author.id}`}
                    variant="primary"
                    className="inline-flex shrink-0 items-center gap-1 text-sm"
                >
                    Більше про автора
                    <ArrowRight className="size-4" aria-hidden />
                </UiLink>
            </div>

            <div className="mt-4 flex items-center gap-4">
                <span className="relative size-14 shrink-0 overflow-hidden rounded-full">
                    <Image
                        src={author.photo}
                        alt={author.name}
                        fill
                        sizes="56px"
                        className="object-cover object-top"
                    />
                </span>
                <div className="min-w-0">
                    <p className="text-foreground text-base font-semibold">
                        {author.name}
                    </p>
                    <p className="text-muted-foreground text-sm">
                        {author.role}
                    </p>
                </div>
            </div>
        </section>
    );
}
