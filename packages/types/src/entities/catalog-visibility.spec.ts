import { canEnterCatalog } from './catalog-visibility';

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
