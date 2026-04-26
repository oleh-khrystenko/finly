import type { ReactNode } from 'react';

export interface UiPageContainerProps {
    /** Lock to exact viewport height (for layouts with pinned footer and inner scroll). Default: false (min-height). */
    fixed?: boolean;
    children: ReactNode;
    className?: string;
}
