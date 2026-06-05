import { HELP_CATEGORIES } from './model/categories';
import { HELP_ARTICLES } from './model/articles';
import type { HelpArticle, HelpCategory } from './types';

const RELATED_LIMIT = 3;

export function getAllCategories(): readonly HelpCategory[] {
    return HELP_CATEGORIES;
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

/**
 * Статті категорії у порядку `order`.
 */
export function getArticlesByCategory(categoryId: string): HelpArticle[] {
    return HELP_ARTICLES.filter((a) => a.categoryId === categoryId).sort(
        (a, b) => a.order - b.order
    );
}

/**
 * Категорії разом зі своїми статтями (для індексу і сайдбара). Порожні
 * категорії відкидаються.
 */
export function getCategoriesWithArticles(): Array<{
    category: HelpCategory;
    articles: HelpArticle[];
}> {
    return HELP_CATEGORIES.map((category) => ({
        category,
        articles: getArticlesByCategory(category.id),
    })).filter((group) => group.articles.length > 0);
}

/**
 * Суміжні статті: спочатку явні `related`, далі добір сусідами тієї ж
 * категорії, без самої статті. Максимум `RELATED_LIMIT`.
 */
export function getRelatedArticles(article: HelpArticle): HelpArticle[] {
    const explicit = (article.related ?? [])
        .map((slug) => getArticleBySlug(slug))
        .filter((a): a is HelpArticle => Boolean(a));

    const fillers = getArticlesByCategory(article.categoryId).filter(
        (a) =>
            a.slug !== article.slug &&
            !explicit.some((e) => e.slug === a.slug)
    );

    return [...explicit, ...fillers].slice(0, RELATED_LIMIT);
}
