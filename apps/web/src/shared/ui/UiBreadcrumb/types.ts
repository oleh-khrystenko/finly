export interface UiBreadcrumbItem {
    label: string;
    /** Ancestor segments link up the tree. The current (last) item omits href. */
    href?: string;
}

export interface UiBreadcrumbProps {
    items: UiBreadcrumbItem[];
    className?: string;
}
