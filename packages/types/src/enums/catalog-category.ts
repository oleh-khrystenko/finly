/**
 * Sprint 29 — категорія отримувача у публічному каталозі. Групує картки на
 * головній pay-хоста. Призначає адмін (системним отримувачам при створенні,
 * користувацьким при схваленні запиту).
 *  - `state`    — державні платежі (податкова, фонди, збори).
 *  - `charity`  — благодійність.
 *  - `business` — звичайні бізнеси (дефолт).
 */
export const CATALOG_CATEGORIES = ['state', 'charity', 'business'] as const;

export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export const DEFAULT_CATALOG_CATEGORY: CatalogCategory = 'business';

/** UA-лейбли секцій каталогу (порядок показу — як у масиві). */
export const CATALOG_CATEGORY_LABEL: Record<CatalogCategory, string> = {
    state: 'Державні платежі',
    charity: 'Благодійність',
    business: 'Бізнеси',
};
