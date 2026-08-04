import { BadgeCheck } from 'lucide-react';
import { composeClasses } from '@/shared/lib';
import type { UiVerifiedBadgeProps } from './types';

const SIZE_CLASSES: Record<NonNullable<UiVerifiedBadgeProps['size']>, string> =
    {
        sm: 'gap-1 px-2 py-0.5 text-xs',
        md: 'gap-1.5 px-2.5 py-1 text-sm',
    };

const ICON_CLASSES: Record<NonNullable<UiVerifiedBadgeProps['size']>, string> =
    {
        sm: 'size-3.5',
        md: 'size-4',
    };

/**
 * Знак довіри для системних отримувачів (податкова, фонди — записи, які завела
 * і перевірила команда Finly). Платник має бачити різницю між державними
 * реквізитами і сторінкою довільного користувача ще до сканування QR: без
 * цього сторінка ГУ ДПС виглядає рівно як чужа вивіска, а на податковій
 * сторінці від нього ще й просять власний РНОКПП.
 *
 * Текст усередині, не лише іконка: сам по собі значок «галочка» читається як
 * прикраса, а тут він несе платіжний сенс.
 */
const UiVerifiedBadge = ({ size = 'md', className }: UiVerifiedBadgeProps) => (
    <span
        className={composeClasses(
            'bg-success/10 text-success inline-flex shrink-0 items-center rounded-full font-medium',
            SIZE_CLASSES[size],
            className
        )}
    >
        <BadgeCheck className={ICON_CLASSES[size]} aria-hidden />
        Перевірений отримувач
    </span>
);

UiVerifiedBadge.displayName = 'UiVerifiedBadge';

export default UiVerifiedBadge;
