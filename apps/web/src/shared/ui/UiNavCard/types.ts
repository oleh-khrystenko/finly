import type { ReactNode } from 'react';

export interface UiNavCardProps {
    /** Внутрішній роут дочірньої сторінки — уся картка веде сюди. */
    href: string;
    /** Заголовок-анкер (назва сутності / сума). */
    title: ReactNode;
    /** Значення для нативного `title=` (hover-tooltip на обрізаному тексті). */
    titleAttr?: string;
    /**
     * Accessible name для лінка-обгортки. Без нього screen-reader зачитав би
     * увесь вкладений текст; короткий label («Відкрити рахунок INV-1») зрозуміліший.
     */
    ariaLabel?: string;
    /** Тихий верхній лейбл (тип / банк / slug). */
    eyebrow?: ReactNode;
    /** Бейдж top-right (статус / тег). */
    badge?: ReactNode;
    /** Вторинні рядки під заголовком (маска, лічильники, призначення). */
    meta?: ReactNode;
    /** Текст footer-афордансу. За замовчуванням «Відкрити». */
    cta?: string;
    /**
     * Поверхня картки. `card` (default) — для сітки на сторінковому фоні
     * (`bg-background`). `muted` — коли картка лежить усередині `UiSectionCard`
     * (`bg-card`): `bg-card` на `bg-card` злився б, тож тайл стає `bg-muted`.
     */
    surface?: 'card' | 'muted';
}
