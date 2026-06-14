import { ONE_OFF_ACCESS_CODES, SUBSCRIPTION_PLAN_CODES } from '@finly/types';
import { CatalogService } from './catalog.service';

describe('CatalogService (static config)', () => {
    const service = new CatalogService();

    it('віддає всі плани підписки і one-off доступи з конфігу', () => {
        const catalog = service.getCatalog();
        expect(catalog.subscriptionPlans.map((p) => p.code)).toEqual(
            Array.from(SUBSCRIPTION_PLAN_CODES)
        );
        expect(catalog.oneOffAccesses.map((p) => p.code)).toEqual(
            Array.from(ONE_OFF_ACCESS_CODES)
        );
    });

    it('ціни у копійках, UAH, з рівнем доступу', () => {
        const catalog = service.getCatalog();
        const brand = catalog.subscriptionPlans.find((p) => p.code === 'brand');
        expect(brand).toMatchObject({
            priceAmount: 4900,
            currency: 'UAH',
            interval: 'month',
            level: 'brand',
        });
        const bookkeeperMonthly = catalog.oneOffAccesses.find(
            (p) => p.code === 'bookkeeper'
        );
        expect(bookkeeperMonthly).toMatchObject({
            priceAmount: 12_900,
            currency: 'UAH',
            level: 'bookkeeper',
            durationMonths: 1,
        });
    });

    it('повертає копію (мутація результату не псує конфіг)', () => {
        const a = service.getCatalog();
        a.subscriptionPlans.pop();
        const b = service.getCatalog();
        expect(b.subscriptionPlans.length).toBe(SUBSCRIPTION_PLAN_CODES.length);
    });
});
