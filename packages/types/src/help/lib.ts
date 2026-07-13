import { HELP_CATEGORIES } from './categories';
import { HELP_ARTICLES } from './articles';
import { HELP_AUTHORS } from './authors';
import type { HelpArticle, HelpAuthor, HelpCategory } from './types';

const RELATED_LIMIT = 3;

export function getAllCategories(): readonly HelpCategory[] {
    return HELP_CATEGORIES;
}

export function getAuthorById(id: string): HelpAuthor | undefined {
    return HELP_AUTHORS.find((a) => a.id === id);
}

export function getCategoryById(id: string): HelpCategory | undefined {
    return HELP_CATEGORIES.find((c) => c.id === id);
}

export function getAllArticles(): readonly HelpArticle[] {
    return HELP_ARTICLES;
}

export function getAllArticleSlugs(): string[] {
    return HELP_ARTICLES.map((a) => a.slug);
}

export function getArticleBySlug(slug: string): HelpArticle | undefined {
    return HELP_ARTICLES.find((a) => a.slug === slug);
}

export function getArticlesByCategory(categoryId: string): HelpArticle[] {
    return HELP_ARTICLES.filter((a) => a.categoryId === categoryId).sort(
        (a, b) => a.order - b.order
    );
}

/** Categories with their articles; empty categories dropped. */
export function getCategoriesWithArticles(): Array<{
    category: HelpCategory;
    articles: HelpArticle[];
}> {
    return HELP_CATEGORIES.map((category) => ({
        category,
        articles: getArticlesByCategory(category.id),
    })).filter((group) => group.articles.length > 0);
}

/** Explicit `related` first, then category siblings, capped at RELATED_LIMIT. */
export function getRelatedArticles(article: HelpArticle): HelpArticle[] {
    const explicit = (article.related ?? [])
        .map((slug) => getArticleBySlug(slug))
        .filter((a): a is HelpArticle => Boolean(a));

    const fillers = getArticlesByCategory(article.categoryId).filter(
        (a) =>
            a.slug !== article.slug && !explicit.some((e) => e.slug === a.slug)
    );

    return [...explicit, ...fillers].slice(0, RELATED_LIMIT);
}

/**
 * Flattens all articles into a single markdown knowledge base for the AI help
 * assistant. Slug is included so the model can link to /help/<slug>. This is
 * the same content the web renders, so page and assistant cannot drift.
 */
export function buildHelpKnowledgeBase(): string {
    return getCategoriesWithArticles()
        .map(({ category, articles }) => {
            const blocks = articles
                .map((a) => `### ${a.title}\nslug: ${a.slug}\n\n${a.body}`)
                .join('\n\n');
            return `## ${category.title}\n${category.description}\n\n${blocks}`;
        })
        .join('\n\n');
}
