import {
    isPublicAccountListed,
    resolvePublicIndexEnabled,
} from './public-index-policy';

describe('resolvePublicIndexEnabled', () => {
    describe('звичайний отримувач', () => {
        it('seoIndexEnabled=true → index незалежно від прапорців каталогу', () => {
            expect(
                resolvePublicIndexEnabled(
                    {
                        seoIndexEnabled: true,
                        isSystem: false,
                        catalogVisible: false,
                    },
                    { catalogVisible: false }
                )
            ).toBe(true);
        });

        it('seoIndexEnabled=false → noindex', () => {
            expect(
                resolvePublicIndexEnabled({
                    seoIndexEnabled: false,
                    isSystem: false,
                    catalogVisible: true,
                })
            ).toBe(false);
        });

        it('legacy-документ без нових полів → index за seoIndexEnabled', () => {
            expect(resolvePublicIndexEnabled({ seoIndexEnabled: true })).toBe(
                true
            );
        });
    });

    describe('системний отримувач', () => {
        const systemVisible = {
            seoIndexEnabled: true,
            isSystem: true,
            catalogVisible: true,
        };

        it('обидва рівні видимі → index', () => {
            expect(
                resolvePublicIndexEnabled(systemVisible, {
                    catalogVisible: true,
                })
            ).toBe(true);
        });

        it('приховані реквізити → noindex (застарілий державний IBAN гасне у пошуку)', () => {
            expect(
                resolvePublicIndexEnabled(systemVisible, {
                    catalogVisible: false,
                })
            ).toBe(false);
        });

        it('прихований отримувач → noindex на всіх рівнях', () => {
            const hidden = { ...systemVisible, catalogVisible: false };
            expect(resolvePublicIndexEnabled(hidden)).toBe(false);
            expect(
                resolvePublicIndexEnabled(hidden, { catalogVisible: true })
            ).toBe(false);
        });

        it('рівень отримувача (без account) видимий → index', () => {
            expect(resolvePublicIndexEnabled(systemVisible)).toBe(true);
        });
    });
});

describe('isPublicAccountListed', () => {
    it('звичайний отримувач — список повний, прапорець каталогу не фільтрує', () => {
        // Дефолт `catalogVisible: false`, тож фільтр тут спорожнив би публічні
        // сторінки всім наявним користувачам.
        expect(
            isPublicAccountListed(
                { isSystem: false },
                { catalogVisible: false }
            )
        ).toBe(true);
        expect(isPublicAccountListed({}, {})).toBe(true);
    });

    it('системний отримувач — приховані реквізити зникають зі сторінки', () => {
        // Сценарій «держава змінила рахунок»: картка каталогу веде саме сюди, і
        // застарілий IBAN інакше лишався б у списку поруч з новим.
        expect(
            isPublicAccountListed({ isSystem: true }, { catalogVisible: false })
        ).toBe(false);
        expect(isPublicAccountListed({ isSystem: true }, {})).toBe(false);
        expect(
            isPublicAccountListed({ isSystem: true }, { catalogVisible: true })
        ).toBe(true);
    });
});
