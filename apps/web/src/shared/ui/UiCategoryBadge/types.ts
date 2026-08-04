import type { CatalogCategory } from '@finly/types';

export interface UiCategoryBadgeProps {
    /** Категорія публічного каталогу; підпис береться з `CATALOG_CATEGORY_LABEL`. */
    category: CatalogCategory;
    /**
     * `sm` — компактний варіант для карток списку, `md` — під назвою отримувача
     * на самій публічній сторінці.
     */
    size?: 'sm' | 'md';
    /** Контекстні відступи місця використання. */
    className?: string;
}
