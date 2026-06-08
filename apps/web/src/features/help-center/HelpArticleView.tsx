import Markdown from 'react-markdown';
import { ChevronRight, ArrowLeft, Bot } from 'lucide-react';

import UiLink from '@/shared/ui/UiLink';
import UiButton from '@/shared/ui/UiButton';
import {
    getCategoryById,
    getRelatedArticles,
    type HelpArticle,
} from '@/entities/help-article';

import { HelpSidebar } from './HelpSidebar';
import { HelpArticleCard } from './HelpArticleCard';
import { HelpCtaBanner } from './HelpCtaBanner';

export function HelpArticleView({ article }: { article: HelpArticle }) {
    const category = getCategoryById(article.categoryId);
    const related = getRelatedArticles(article);

    return (
        <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 md:py-14 lg:px-8">
            <div className="lg:grid lg:grid-cols-[15rem_1fr] lg:gap-12">
                <HelpSidebar currentSlug={article.slug} />

                <article className="min-w-0">
                    <nav
                        aria-label="Хлібні крихти"
                        className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm"
                    >
                        <UiLink as="link" href="/help" variant="muted">
                            Довідка
                        </UiLink>
                        {category && (
                            <>
                                <ChevronRight
                                    className="size-3.5"
                                    aria-hidden="true"
                                />
                                <span>{category.title}</span>
                            </>
                        )}
                    </nav>

                    <h1 className="text-foreground mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
                        {article.title}
                    </h1>
                    <p className="text-muted-foreground mt-2 text-base leading-relaxed">
                        {article.description}
                    </p>

                    <div className="prose-help text-foreground/90 mt-6">
                        <Markdown>{article.body}</Markdown>
                    </div>

                    <aside className="border-border bg-muted/40 mt-10 flex items-center gap-4 rounded-xl border p-5">
                        <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
                            <Bot className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="text-foreground text-sm font-medium">
                                Не знайшли відповідь?
                            </p>
                            <p className="text-muted-foreground text-sm">
                                Запитайте AI-помічника просто словами.
                            </p>
                        </div>
                        <UiButton
                            as="link"
                            href="/help#assistant"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                        >
                            Запитати
                        </UiButton>
                    </aside>

                    {related.length > 0 && (
                        <section
                            className="mt-10"
                            aria-labelledby="related-heading"
                        >
                            <h2
                                id="related-heading"
                                className="text-foreground text-base font-semibold tracking-tight"
                            >
                                Дивіться також
                            </h2>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                {related.map((item) => (
                                    <HelpArticleCard
                                        key={item.slug}
                                        article={item}
                                    />
                                ))}
                            </div>
                        </section>
                    )}

                    <div className="mt-10">
                        <UiButton
                            as="link"
                            href="/help"
                            variant="text"
                            size="sm"
                            IconLeft={<ArrowLeft className="size-4" />}
                        >
                            Усі розділи довідки
                        </UiButton>
                    </div>

                    <HelpCtaBanner />
                </article>
            </div>
        </main>
    );
}
