import { ONE_OFF_ACCESS_CODES, SUBSCRIPTION_PLAN_CODES } from '@finly/types';
import { ENV } from '../../config/env';
import { CatalogService } from './catalog.service';

describe('CatalogService (env-driven prices)', () => {
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

    it('getSubscriptionPlan/getOneOffAccess повертають env-ціну, undefined для невідомого', () => {
        expect(service.getSubscriptionPlan('brand')?.priceAmount).toBe(
            ENV.BILLING_PRICE_SUBSCRIPTION_BRAND * 100
        );
        expect(service.getOneOffAccess('bookkeeper')?.priceAmount).toBe(
            ENV.BILLING_PRICE_ONEOFF_BOOKKEEPER * 100
        );
        expect(service.getSubscriptionPlan('legacy')).toBeUndefined();
        expect(service.getOneOffAccess('legacy')).toBeUndefined();
    });

    it('ціна деривується з ENV (зміна гривень → зміна копійок)', () => {
        const original = ENV.BILLING_PRICE_SUBSCRIPTION_BRAND;
        const env = ENV as { BILLING_PRICE_SUBSCRIPTION_BRAND: number };
        try {
            env.BILLING_PRICE_SUBSCRIPTION_BRAND = 59;
            expect(service.getSubscriptionPlan('brand')?.priceAmount).toBe(
                5900
            );
        } finally {
            env.BILLING_PRICE_SUBSCRIPTION_BRAND = original;
        }
    });
});
