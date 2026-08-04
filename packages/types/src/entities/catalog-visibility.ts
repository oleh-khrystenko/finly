import {
    DEFAULT_CATALOG_CATEGORY,
    type CatalogCategory,
} from '../enums/catalog-category';
import type { PublicityStatus } from '../enums/publicity-status';

/**
 * Sprint 29 — правило допуску рівня (отримувач / реквізити / документ) у
 * публічний каталог, СПІЛЬНЕ для двох поверхонь:
 *  - тогл видимості: увімкнути `catalogVisible = true` дозволено лише коли рівень
 *    допущений (інакше видимість нічого не значила б і плутала б користувача);
 *  - читання каталогу (окремий зріз): показуємо рівень, лише коли він допущений
 *    І `catalogVisible === true`.
 *
 * Допуск: отримувач публічний (системний або зі схваленим запитом) І slug
 * красивий (змінений вручну). Красивий slug вимагає тарифу «Бренд», тож
 * публічність де-факто преміальна (Sprint 29 §монетизація).
 *
 * `catalogVisible` навмисно ПОЗА цим предикатом: сам прапор — намір користувача,
 * а не право; предикат каже, чи цей намір взагалі може здійснитись.
 */
export function canEnterCatalog(params: {
    isSystem: boolean;
    publicityStatus: PublicityStatus;
    slugCustomized: boolean;
}): boolean {
    // Системний отримувач — адмін-курована інфраструктура ПОЗА білінгом. Гейт
    // красивого slug існує лише як монетизація «Бренд» для користувацьких
    // отримувачів; до системних він не застосовується (їхній slug авто-згенеро-
    // ваний, кастомізувати його немає ким і немає навіщо). Без цього винятку
    // системний запис ніколи не пройшов би у каталог — головна ціль спринту.
    if (params.isSystem) {
        return true;
    }
    return params.publicityStatus === 'approved' && params.slugCustomized;
}

/**
 * Категорія, під якою отримувач стоїть у публічному каталозі — або `undefined`,
 * якщо його там немає. Публічні сторінки показують цю мітку поруч з назвою:
 * платник, що прийшов з каталогу чи за прямим посиланням, бачить, до якої
 * вітрини належить сторінка, а не лише чию назву він читає.
 *
 * Допуск (`canEnterCatalog`) І намір (`catalogVisible`) — обидві умови, тобто
 * рівно те, що робить запис видимим у каталозі. Наявність допущених реквізитів
 * сюди свідомо не входить, хоча картку у вітрині вона теж гейтить
 * (`getPublicCatalog`): мітка описує приналежність отримувача, а не наявність
 * картки, і не має блимати від того, що адмін тимчасово сховав один IBAN.
 *
 * Фолбек на дефолтну категорію з тієї ж причини, що у каталозі: у документів,
 * створених до Sprint 29, поля фізично немає, і без фолбека схвалений отримувач
 * лишився б без мітки.
 */
export function resolvePublicCatalogCategory(params: {
    isSystem: boolean;
    publicityStatus: PublicityStatus;
    slugCustomized: boolean;
    catalogVisible: boolean;
    catalogCategory?: CatalogCategory;
}): CatalogCategory | undefined {
    if (!params.catalogVisible || !canEnterCatalog(params)) {
        return undefined;
    }
    return params.catalogCategory ?? DEFAULT_CATALOG_CATEGORY;
}
