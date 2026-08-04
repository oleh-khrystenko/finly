import {
    canEnterCatalog,
    resolvePublicCatalogCategory,
} from './catalog-visibility';

describe('canEnterCatalog', () => {
    it('системний отримувач з красивим slug — допущений', () => {
        expect(
            canEnterCatalog({
                isSystem: true,
                publicityStatus: 'none',
                slugCustomized: true,
            })
        ).toBe(true);
    });

    it('системний з авто-slug — допущений (гейт красивого slug поза білінгом його не стосується)', () => {
        expect(
            canEnterCatalog({
                isSystem: true,
                publicityStatus: 'none',
                slugCustomized: false,
            })
        ).toBe(true);
    });

    it('звичайний схвалений з красивим slug — допущений', () => {
        expect(
            canEnterCatalog({
                isSystem: false,
                publicityStatus: 'approved',
                slugCustomized: true,
            })
        ).toBe(true);
    });

    it('звичайний схвалений без красивого slug — недопущений', () => {
        expect(
            canEnterCatalog({
                isSystem: false,
                publicityStatus: 'approved',
                slugCustomized: false,
            })
        ).toBe(false);
    });

    it('звичайний pending — недопущений навіть з красивим slug', () => {
        expect(
            canEnterCatalog({
                isSystem: false,
                publicityStatus: 'pending',
                slugCustomized: true,
            })
        ).toBe(false);
    });

    it('звичайний без запиту — недопущений', () => {
        expect(
            canEnterCatalog({
                isSystem: false,
                publicityStatus: 'none',
                slugCustomized: true,
            })
        ).toBe(false);
    });
});

describe('resolvePublicCatalogCategory', () => {
    const systemPayee = {
        isSystem: true,
        publicityStatus: 'none',
        slugCustomized: false,
        catalogVisible: true,
        catalogCategory: 'state',
    } as const;

    it('системний видимий отримувач віддає свою категорію', () => {
        expect(resolvePublicCatalogCategory(systemPayee)).toBe('state');
    });

    it('прихований з каталогу — без мітки, хоч і допущений', () => {
        expect(
            resolvePublicCatalogCategory({
                ...systemPayee,
                catalogVisible: false,
            })
        ).toBeUndefined();
    });

    it('недопущений — без мітки, хоч видимість і увімкнена', () => {
        expect(
            resolvePublicCatalogCategory({
                isSystem: false,
                publicityStatus: 'pending',
                slugCustomized: true,
                catalogVisible: true,
                catalogCategory: 'business',
            })
        ).toBeUndefined();
    });

    it('документ без категорії (створений до Sprint 29) падає у дефолтну секцію', () => {
        // Той самий фолбек, що у `getPublicCatalog`: інакше схвалений отримувач
        // стояв би у каталозі під «Бізнеси», а на власній сторінці був би без
        // мітки взагалі.
        expect(
            resolvePublicCatalogCategory({
                isSystem: false,
                publicityStatus: 'approved',
                slugCustomized: true,
                catalogVisible: true,
            })
        ).toBe('business');
    });
});
