import type { ReactNode } from 'react';

export type UiTabsSize = 'sm' | 'md';

/**
 * Тон лічильника біля лейбла. `neutral` (дефолт) — спокійний сірий, щоб не
 * конкурувати з primary-підкресленням активного табу. `primary` — коли число
 * має привертати увагу (наприклад «на розгляді»).
 */
export type UiTabCountTone = 'neutral' | 'primary';

/** Спільні поля табу обох режимів. `TValue` тримає домен-тип ключа. */
export interface UiTabItemBase<TValue extends string = string> {
    /** Стабільний ключ табу (і значення для `onChange` у panel-режимі). */
    value: TValue;
    label: ReactNode;
    /** Опційна іконка перед лейблом (lucide-svg). */
    icon?: ReactNode;
    /** Badge-лічильник праворуч від лейбла. Не рендериться, якщо не задано. */
    count?: number;
    countTone?: UiTabCountTone;
    /** Явний aria-label (перекриває видимий лейбл для скрін-рідерів). */
    ariaLabel?: string;
}

/** Таб у panel-режимі — перемикає контент у межах сторінки. */
export interface UiTabItem<
    TValue extends string = string,
> extends UiTabItemBase<TValue> {
    /**
     * Неактивний таб: `aria-disabled`, приглушений, `onChange` не спрацьовує.
     * Лишається фокусованим (APG) і не зсуває індексацію — тож `value` може
     * вказувати й на нього, підсвітка від цього не з'їде.
     */
    disabled?: boolean;
}

/** Таб у nav-режимі — окремий маршрут (deep-link, кнопка «назад»). */
export interface UiTabNavItem<
    TValue extends string = string,
> extends UiTabItemBase<TValue> {
    href: string;
}

interface UiTabsCommon {
    size?: UiTabsSize;
    className?: string;
    /** Обов'язкова назва набору табів для скрін-рідерів. */
    'aria-label': string;
}

/**
 * Panel-режим (дефолт): controlled `value` + `onChange`, контент перемикає
 * consumer умовним рендером. Під капотом Headless UI `TabGroup` — ролі
 * tablist/tab, стрілкова навігація, roving-tabindex з коробки.
 *
 * Контент панелі живе у consumer-а, тож ARIA-зв'язок таб → панель замикається
 * ззовні: `panelId` обов'язковий, а контейнер контенту мусить отримати
 * `uiTabPanelProps(panelId, activeLabel)`. Без цього таби мали б `role="tab"`
 * без жодної панелі, і скрін-рідер не мав би куди перейти з табліста.
 */
export interface UiTabsPanelProps<
    TValue extends string = string,
> extends UiTabsCommon {
    as?: 'panel';
    items: UiTabItem<TValue>[];
    value: TValue;
    onChange: (value: TValue) => void;
    /** id контейнера панелі — той самий, що переданий у `uiTabPanelProps`. */
    panelId: string;
}

/**
 * Nav-режим: кожен таб — окремий URL. Активність визначається за поточним
 * pathname (точний збіг або префікс `href + '/'`), тож підсвітка тримається на
 * під-сторінках. Семантика — `nav` + `aria-current`, не tablist (це навігація
 * між маршрутами, а не панелі в межах сторінки), тож панель тут не потрібна.
 */
export interface UiTabsNavProps<
    TValue extends string = string,
> extends UiTabsCommon {
    as: 'nav';
    items: UiTabNavItem<TValue>[];
}

export type UiTabsProps<TValue extends string = string> =
    | UiTabsPanelProps<TValue>
    | UiTabsNavProps<TValue>;

/** Атрибути контейнера панелі у panel-режимі (див. `uiTabPanelProps`). */
export interface UiTabPanelProps {
    id: string;
    role: 'tabpanel';
    'aria-label': string;
}
