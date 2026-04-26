import { InputHTMLAttributes, ReactNode } from 'react';

export type UiInputVariant = 'outlined' | 'filled';
export type UiInputSize = 'sm' | 'md' | 'lg';

export interface UiInputProps extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'size'
> {
    variant?: UiInputVariant;
    size?: UiInputSize;
    label?: string;
    error?: string;
    IconLeft?: ReactNode;
    IconRight?: ReactNode;
}
