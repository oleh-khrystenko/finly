import type { ReactNode } from 'react';

export interface UiSectionCardProps {
    title: string;
    headerRight?: ReactNode;
    variant?: 'default' | 'destructive';
    className?: string;
    children: ReactNode;
}
