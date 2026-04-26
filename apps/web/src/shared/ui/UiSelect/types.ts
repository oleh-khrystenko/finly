import { ReactNode } from 'react';

export type UiSelectVariant = 'filled' | 'outlined';
export type UiSelectSize = 'sm' | 'md' | 'lg';

export interface UiSelectOption {
    label: ReactNode;
    value: string;
}

/**
 * Base props for UiSelect component
 */
export interface UiSelectProps {
    options: UiSelectOption[];
    value: string;
    onChange: (value: string) => void;
    variant?: UiSelectVariant;
    size?: UiSelectSize;
    className?: string;
    disabled?: boolean;
    placeholder?: string;
    label?: string;
    required?: boolean;
    error?: ReactNode;
}
