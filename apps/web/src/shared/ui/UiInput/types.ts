import { InputHTMLAttributes, ReactNode } from 'react';

export type UiInputVariant = 'outlined' | 'filled';
export type UiInputSize = 'sm' | 'md' | 'lg';

export interface UiInputProps extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'size'
> {
    variant?: UiInputVariant;
    size?: UiInputSize;
    /** Розмір лейбла: `sm` (14px, default) або `md` (16px — ритм еталона). */
    labelSize?: 'sm' | 'md';
    label?: string;
    description?: string;
    error?: string;
    IconLeft?: ReactNode;
    IconRight?: ReactNode;
}
