import { ReactNode } from 'react';

export type UiDropdownMenuSize = 'sm' | 'md' | 'lg';
export type UiDropdownMenuAlign = 'start' | 'end';

export interface UiDropdownMenuItem {
    label: ReactNode;
    value: string;
    icon?: ReactNode;
    badge?: ReactNode;
}

export interface UiDropdownMenuProps {
    items: UiDropdownMenuItem[];
    onSelect: (value: string) => void;
    activeValue?: string;
    trigger: ReactNode;
    header?: ReactNode;
    align?: UiDropdownMenuAlign;
    size?: UiDropdownMenuSize;
    className?: string;
    /** Додаткові класи на кожен пункт меню (напр. responsive size-override). */
    itemClassName?: string;
    /** Додаткові класи на бейдж пункту (напр. responsive font-size). */
    badgeClassName?: string;
}
