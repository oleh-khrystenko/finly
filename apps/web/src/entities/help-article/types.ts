import type { LucideIcon } from 'lucide-react';

/**
 * Категорія довідки. Групує статті у help-center і дає секцію на індексі
 * та блок у сайдбарі.
 */
export interface HelpCategory {
    id: string;
    title: string;
    description: string;
    icon: LucideIcon;
}

/**
 * Стаття довідки. `body` — markdown-рядок (єдине джерело правди: ця ж стаття
 * рендериться на сторінці і згодовується AI як база знань, Sprint 16).
 *
 * `slug` стабільний з моменту публікації: зміна ламає зовнішні посилання,
 * надруковані матеріали і SEO.
 */
export interface HelpArticle {
    slug: string;
    title: string;
    /** Короткий опис: SEO-meta + текст картки на індексі. */
    description: string;
    categoryId: HelpCategory['id'];
    /** Порядок усередині категорії. */
    order: number;
    body: string;
    /** Явні суміжні статті; якщо порожньо, fallback на сусідів категорії. */
    related?: string[];
}
