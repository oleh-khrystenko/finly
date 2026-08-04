import { ReactNode } from 'react';

export type UiSelectVariant = 'filled' | 'outlined';
export type UiSelectSize = 'sm' | 'md' | 'lg';

export interface UiSelectOption {
    label: ReactNode;
    value: string;
    /**
     * Підпис секції над опцією. Секція починається там, де значення
     * змінюється, тож опції однієї групи мусять іти поспіль — розкидані по
     * списку дадуть повторені заголовки, а не одну секцію. Групування суто
     * візуальне: у закритому стані видно лише `label`, тому підпис опції має
     * лишатись зрозумілим і без заголовка.
     */
    group?: string;
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
    /** Розмір лейбла: `sm` (14px, default) або `md` (16px — ритм еталона). */
    labelSize?: 'sm' | 'md';
    className?: string;
    disabled?: boolean;
    placeholder?: string;
    label?: string;
    required?: boolean;
    error?: ReactNode;
}
