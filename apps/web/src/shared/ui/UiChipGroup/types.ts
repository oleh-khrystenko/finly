import { ReactNode } from 'react';

export type UiChipGroupSize = 'sm' | 'md' | 'lg';

export interface UiChipGroupOption {
    label: ReactNode;
    value: string;
}

export interface UiChipGroupProps {
    options: UiChipGroupOption[];
    value: string;
    onChange: (value: string) => void;
    size?: UiChipGroupSize;
    className?: string;
    disabled?: boolean;
    label?: string;
    required?: boolean;
    error?: ReactNode;
}
