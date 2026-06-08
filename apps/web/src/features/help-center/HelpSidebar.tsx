import UiLink from '@/shared/ui/UiLink';
import { getCategoriesWithArticles } from '@/entities/help-article';

/**
 * Бічна навігація статті (desktop). На mobile прихована: там роль навігації
 * виконують breadcrumb, суміжні статті і back-link.
 */
export function HelpSidebar({ currentSlug }: { currentSlug?: string }) {
    const groups = getCategoriesWithArticles();

    return (
        <nav aria-label="Розділи довідки" className="hidden lg:block">
            <div className="sticky top-20 space-y-6">
                {groups.map(({ category, articles }) => (
                    <div key={category.id}>
                        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                            {category.title}
                        </p>
                        <ul className="mt-2 space-y-0.5">
                            {articles.map((article) => {
                                const active = article.slug === currentSlug;
                                return (
                                    <li key={article.slug}>
                                        <UiLink
                                            as="link"
                                            href={`/help/${article.slug}`}
                                            variant="unstyled"
                                            aria-current={
                                                active ? 'page' : undefined
                                            }
                                            className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                                                active
                                                    ? 'bg-primary/10 text-primary font-medium'
                                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                                            }`}
                                        >
                                            {article.title}
                                        </UiLink>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </div>
        </nav>
    );
}
