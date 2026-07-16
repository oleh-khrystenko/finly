import type { HelpArticle } from '@/entities/help-article';

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
 * Top-of-article meta: just the freshness date. Help is support documentation,
 * so the top carries an institutional "updated on" line, not a personal byline.
 * The expert attribution lives in AuthorCard at the end of the article.
 */
export function HelpArticleMeta({ article }: { article: HelpArticle }) {
    const updated = DATE_FMT.format(new Date(article.dateModified));

    return (
        <p className="text-muted-foreground mt-3 text-sm">Оновлено {updated}</p>
    );
}
