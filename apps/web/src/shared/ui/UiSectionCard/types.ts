import type { ReactNode } from 'react';

export interface UiSectionCardProps {
    title: string;
    headerRight?: ReactNode;
    variant?: 'default' | 'destructive';
    className?: string;
    /**
     * Sprint 4 §4.4 — hash-anchor target для scroll-into-view (наприклад,
     * `#invoices` від `BusinessCard.headerRight`-link-а на listing-page).
     * Render як HTML `id` на корінь section-у; рідкісно потрібен у Sprint 3,
     * тож optional.
     */
    id?: string;
    children: ReactNode;
}
