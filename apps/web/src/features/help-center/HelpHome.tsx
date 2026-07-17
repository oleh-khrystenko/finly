import { getCategoriesWithArticles } from '@/entities/help-article';
import { HelpChat } from '@/features/help-chat';

import { HelpArticleCard } from './HelpArticleCard';

export function HelpHome() {
    const groups = getCategoriesWithArticles();

    return (
        <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 md:py-16 lg:px-8">
            <header className="text-center">
                <h1 className="text-foreground text-3xl font-semibold tracking-tight md:text-4xl">
                    Довідка Finly
                </h1>
                <p className="text-muted-foreground mx-auto mt-3 max-w-xl text-base leading-relaxed">
                    Як приймати оплати через платіжні QR-коди за стандартом НБУ.
                    Знайдіть статтю нижче або запитайте помічника.
                </p>
            </header>

            <section
                id="assistant"
                aria-label="AI-помічник"
                className="mt-8 scroll-mt-20 md:mt-10"
            >
                <HelpChat />
            </section>

            <div id="categories" className="mt-14 scroll-mt-20 space-y-12">
                {groups.map(({ category, articles }) => {
                    const Icon = category.icon;
                    return (
                        <section
                            key={category.id}
                            aria-labelledby={`cat-${category.id}`}
                        >
                            <div className="flex items-center gap-3">
                                <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                                    <Icon className="size-5" />
                                </span>
                                <div>
                                    <h2
                                        id={`cat-${category.id}`}
                                        className="text-foreground text-lg font-semibold tracking-tight"
                                    >
                                        {category.title}
                                    </h2>
                                    <p className="text-muted-foreground text-sm">
                                        {category.description}
                                    </p>
                                </div>
                            </div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                {articles.map((article) => (
                                    <HelpArticleCard
                                        key={article.slug}
                                        article={article}
                                    />
                                ))}
                            </div>
                        </section>
                    );
                })}
            </div>
        </main>
    );
}
