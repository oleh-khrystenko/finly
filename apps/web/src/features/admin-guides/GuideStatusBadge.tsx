import type { GuideStatus } from '@finly/types';

/** Пігулка статусу гайда (чернетка/опубліковано). Спільна для списку і редактора. */
export function GuideStatusBadge({ status }: { status: GuideStatus }) {
    const published = status === 'published';
    return (
        <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                published
                    ? 'bg-success/10 text-success'
                    : 'bg-muted text-muted-foreground'
            }`}
        >
            {published ? 'Опубліковано' : 'Чернетка'}
        </span>
    );
}
