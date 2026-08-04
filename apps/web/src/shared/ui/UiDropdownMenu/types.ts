import { ReactNode } from 'react';

export type UiDropdownMenuSize = 'sm' | 'md' | 'lg';
export type UiDropdownMenuAlign = 'start' | 'end';
/** Напрямок розкриття панелі відносно тригера. */
export type UiDropdownMenuSide = 'top' | 'bottom';

export interface UiDropdownMenuItem {
    label: ReactNode;
    value: string;
    icon?: ReactNode;
    badge?: ReactNode;
    /** `destructive` — червоний текст + червоний focus-стан (напр. «Вийти»). */
    tone?: 'default' | 'destructive';
    /** Тонка лінія-розділювач над пунктом — межа смислової групи меню. */
    separatorBefore?: boolean;
    /**
     * Рендерить пункт справжнім посиланням замість кнопки: контекстне меню,
     * Ctrl/середній клік у нову вкладку, копіювання адреси, робота без JS.
     * Внутрішні шляхи йдуть через `next/link` (prefetch + client-навігація),
     * зовнішні — через `external`. `onSelect` все одно викликається (закрити
     * drawer), тож навігацію дублювати роутером не треба.
     */
    href?: string;
    /**
     * `href` веде за межі застосунку (`mailto:`, `tel:`, зовнішній URL) — тоді
     * рендериться голий `<a>`, бо `next/link` тут нічого не дає.
     */
    external?: boolean;
    /**
     * Показує праворуч кнопку «Скопіювати» з цим значенням — для пунктів, чий
     * текст і є даними (email, адреса). Це окремий пункт меню (досяжний
     * стрілками), тож копіювання не активує сусідній пункт, але закриває меню;
     * фідбек — toast.
     */
    copyValue?: string;
    /**
     * Текст toast-у після успішного копіювання. Дефолт нейтральний
     * («Скопійовано»), бо примітив не знає, що саме за дані у `copyValue`.
     */
    copySuccessMessage?: string;
}

export interface UiDropdownMenuProps {
    items: UiDropdownMenuItem[];
    onSelect: (value: string) => void;
    activeValue?: string;
    trigger: ReactNode;
    header?: ReactNode;
    align?: UiDropdownMenuAlign;
    /** `bottom` (типово) розкриває вниз; `top` — вгору (для тригерів унизу екрана). */
    side?: UiDropdownMenuSide;
    size?: UiDropdownMenuSize;
    className?: string;
    /** Класи на корінь `Menu` (напр. `w-full` для full-width тригера). */
    rootClassName?: string;
    /** Додаткові класи на кожен пункт меню (напр. responsive size-override). */
    itemClassName?: string;
    /** Додаткові класи на бейдж пункту (напр. responsive font-size). */
    badgeClassName?: string;
}
