import { composeClasses } from '@/shared/lib';
import type { UiCardGridProps } from './types';

/**
 * Auto-fill сітка карток робочих списків (отримувачі, реквізити, рахунки):
 * на широкому моніторі сторінка отримує більше колонок, а не ширші картки.
 *
 * `min(18rem,100%)` — трек не ширший за контейнер: на 320px картка живе у
 * 256px (page px-4 + card p-4), а голий `minmax(18rem,…)` виштовхував би її
 * за край екрана. `18rem` мінімуму картки — єдина точка правди для всіх
 * списків.
 */
const UiCardGrid = ({ children, className }: UiCardGridProps) => (
    <div
        className={composeClasses(
            'grid grid-cols-[repeat(auto-fill,minmax(min(18rem,100%),1fr))] gap-4',
            className
        )}
    >
        {children}
    </div>
);

UiCardGrid.displayName = 'UiCardGrid';

export default UiCardGrid;
