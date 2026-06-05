import {
    getAllCategories as getAllCategoriesData,
    getCategoryById as getCategoryByIdData,
    getCategoriesWithArticles as getCategoriesWithArticlesData,
    type HelpArticle,
    type HelpCategory as HelpCategoryData,
} from '@finly/types';

import { getCategoryIcon } from './model/categoryIcons';
import type { HelpCategory } from './types';

export {
    getAllArticles,
    getAllArticleSlugs,
    getArticleBySlug,
    getArticlesByCategory,
    getRelatedArticles,
} from '@finly/types';

function withIcon(category: HelpCategoryData): HelpCategory {
    return { ...category, icon: getCategoryIcon(category.id) };
}

export function getAllCategories(): HelpCategory[] {
    return getAllCategoriesData().map(withIcon);
}

export function getCategoryById(id: string): HelpCategory | undefined {
    const category = getCategoryByIdData(id);
    return category ? withIcon(category) : undefined;
}

export function getCategoriesWithArticles(): Array<{
    category: HelpCategory;
    articles: HelpArticle[];
}> {
    return getCategoriesWithArticlesData().map(({ category, articles }) => ({
        category: withIcon(category),
        articles,
    }));
}
