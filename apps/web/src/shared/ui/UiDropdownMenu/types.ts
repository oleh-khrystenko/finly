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
}
