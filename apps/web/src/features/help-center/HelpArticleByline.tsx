import Image from 'next/image';

import { getAuthorById, type HelpArticle } from '@/entities/help-article';

// dateModified — date-only ISO (парситься як UTC-північ). Без явного tz формат
// зʼїхав би на день назад на білд-машині позаду UTC; тримаємо київський час, як
// і решта дат у проєкті.
const DATE_FMT = new Intl.DateTimeFormat('uk-UA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Kyiv',
});

/**
 * Visible byline under the article title: author photo, name, role and the
 * last-updated date. A named practitioner is an E-E-A-T trust signal for the
 * human reader, mirrored by the Person node in the page structured data.
 */
export function HelpArticleByline({ article }: { article: HelpArticle }) {
    const author = getAuthorById(article.authorId);
    if (!author) return null;

    const updated = DATE_FMT.format(new Date(article.dateModified));

    return (
        <div className="border-border mt-5 flex items-center gap-3 border-t border-b py-4">
            <span className="relative size-10 shrink-0 overflow-hidden rounded-full">
                <Image
                    src={author.photo}
                    alt={author.name}
                    fill
                    sizes="40px"
                    className="object-cover object-top"
                />
            </span>
            <div className="min-w-0 text-sm leading-snug">
                <p className="text-foreground font-medium">{author.name}</p>
                <p className="text-muted-foreground">
                    {author.role}
                    <span aria-hidden> · </span>
                    <span className="whitespace-nowrap">
                        Оновлено {updated}
                    </span>
                </p>
            </div>
        </div>
    );
}
