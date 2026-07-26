import type { ReactNode } from 'react';

export interface UiWorkspaceColumnsProps {
    /** Основний робочий стовп — ліворуч на xl+, перший у стосі нижче. */
    main: ReactNode;
    /** Допоміжний стовп (25rem) — праворуч на xl+, після main у стосі. */
    aside: ReactNode;
    className?: string;
}
