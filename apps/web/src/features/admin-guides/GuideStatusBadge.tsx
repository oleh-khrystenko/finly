import type { GuideStatus } from '@finly/types';

const STATUS_STYLES: Record<GuideStatus, { label: string; className: string }> =
    {
        planned: {
            label: 'Запланована',
            className: 'bg-primary/10 text-primary',
        },
        draft: {
            label: 'Чернетка',
            className: 'bg-muted text-muted-foreground',
        },
        published: {
            label: 'Опубліковано',
            className: 'bg-success/10 text-success',
        },
    };

/** Пігулка статусу гайда (запланована/чернетка/опубліковано). */
export function GuideStatusBadge({ status }: { status: GuideStatus }) {
    const { label, className } = STATUS_STYLES[status];
    return (
        <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${className}`}
        >
            {label}
        </span>
    );
}
