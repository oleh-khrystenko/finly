import { CATALOG_CATEGORY_LABEL } from '@finly/types';
import { composeClasses } from '@/shared/lib';
import type { UiCategoryBadgeProps } from './types';

const SIZE_CLASSES: Record<NonNullable<UiCategoryBadgeProps['size']>, string> = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
};

/**
 * Категорія публічного каталогу («Державні платежі», «Благодійність»,
 * «Бізнеси») поруч з назвою отримувача. Платник приходить на сторінку і за
 * прямим посиланням теж, тож розділ вітрини, до якого належить отримувач, має
 * бути видимий на самій сторінці, а не лише у каталозі, звідки клікнули.
 *
 * Нейтральний фон свідомо: знак довіри (`UiVerifiedBadge`) стоїть поруч і має
 * лишатись помітнішим — категорія описує розділ, а не перевіреність.
 */
const UiCategoryBadge = ({
    category,
    size = 'md',
    className,
}: UiCategoryBadgeProps) => (
    <span
        className={composeClasses(
            'bg-secondary text-muted-foreground inline-flex shrink-0 items-center rounded-full font-medium',
            SIZE_CLASSES[size],
            className
        )}
    >
        {CATALOG_CATEGORY_LABEL[category]}
    </span>
);

UiCategoryBadge.displayName = 'UiCategoryBadge';

export default UiCategoryBadge;
