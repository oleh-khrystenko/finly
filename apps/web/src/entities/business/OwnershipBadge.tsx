import { composeClasses } from '@/shared/lib';

interface OwnershipBadgeProps {
    /** `business.ownerId === currentUserId` — обчислюється на сторінці. */
    isOwner: boolean;
}

/**
 * Бейдж контексту для глибоких cabinet-сторінок (отримувач / реквізити /
 * рахунок). Власність — факт самого бізнесу (`ownerId` проти поточного
 * user-а), тож бейдж завжди коректний, навіть якщо зайшли прямим лінком чи
 * закладкою повз таби на /business. Дзеркалить роль-фреймінг тих табів:
 * «Ви власник» (нейтральний) vs «Ви бухгалтер» (акцент — клієнтський
 * контекст важливо не загубити).
 *
 * Presentational: store не читає (FSD — без cross-entity залежності);
 * сторінка передає `isOwner` і сама гейтить рендер до підвантаження user-а.
 */
export function OwnershipBadge({ isOwner }: OwnershipBadgeProps) {
    return (
        <span
            className={composeClasses(
                'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
                isOwner
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-primary/10 text-primary'
            )}
        >
            {isOwner ? 'Ви власник' : 'Ви бухгалтер'}
        </span>
    );
}
