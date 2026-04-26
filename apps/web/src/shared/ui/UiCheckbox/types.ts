import { ReactNode } from 'react';

export type UiCheckboxSize = 'sm' | 'md' | 'lg';

export interface UiCheckboxProps {
    checked: boolean;
    onChange?: (checked: boolean) => void;
    children?: ReactNode;
    size?: UiCheckboxSize;
    className?: string;
    disabled?: boolean;
    id?: string;
    name?: string;
    error?: string;
}
