import type { CatalogCategory } from '@finly/types';
import UiCategoryBadge from '@/shared/ui/UiCategoryBadge';
import UiVerifiedBadge from '@/shared/ui/UiVerifiedBadge';
import { composeClasses } from '@/shared/lib';

interface PayeeBadgesProps {
    /** Системний (заведений адміном) отримувач — знак довіри. */
    isSystem: boolean;
    /**
     * Категорія публічного каталогу; `undefined` — отримувач поза каталогом
     * (`resolvePublicCatalogCategory` на боці API).
     */
    catalogCategory?: CatalogCategory;
    /** Контекстні відступи місця використання. */
    className?: string;
}

/**
 * Публічні маркери отримувача під його назвою: знак довіри і розділ каталогу.
 * Один рядок на обидва, бо разом вони читаються як одна відповідь на питання
 * «чия це сторінка»: перевірений запис у розділі «Державні платежі» — не те
 * саме, що перевірений запис узагалі.
 *
 * Живе в `entities/business`, а не всередині однієї з фіч: ті самі маркери
 * малюють і вивіска отримувача (`business-public`), і сторінка реквізитів
 * (`account-public`), а cross-feature імпорт заборонений.
 */
export function PayeeBadges({
    isSystem,
    catalogCategory,
    className,
}: PayeeBadgesProps) {
    if (!isSystem && !catalogCategory) {
        return null;
    }
    return (
        <div
            className={composeClasses(
                'flex flex-wrap items-center justify-center gap-2',
                className
            )}
        >
            {isSystem && <UiVerifiedBadge />}
            {catalogCategory && <UiCategoryBadge category={catalogCategory} />}
        </div>
    );
}
