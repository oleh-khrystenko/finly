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
