import {
    EXECUTION_PACK_CODES,
    SUBSCRIPTION_PLAN_CODES,
} from '@finly/types';
import { CatalogService } from './catalog.service';

describe('CatalogService (static config)', () => {
    const service = new CatalogService();

    it('віддає всі плани підписки і пакети з конфігу', () => {
        const catalog = service.getCatalog();
        expect(catalog.subscriptionPlans.map((p) => p.code)).toEqual(
            Array.from(SUBSCRIPTION_PLAN_CODES)
        );
        expect(catalog.executionPacks.map((p) => p.code)).toEqual(
            Array.from(EXECUTION_PACK_CODES)
        );
    });

    it('ціни у копійках та UAH', () => {
        const catalog = service.getCatalog();
        const starter = catalog.subscriptionPlans.find(
            (p) => p.code === 'starter'
        );
        expect(starter).toMatchObject({
            priceAmount: 4900,
            currency: 'UAH',
            interval: 'month',
            executions: 10_000,
        });
    });

    it('повертає копію (мутація результату не псує конфіг)', () => {
        const a = service.getCatalog();
        a.subscriptionPlans.pop();
        const b = service.getCatalog();
        expect(b.subscriptionPlans.length).toBe(SUBSCRIPTION_PLAN_CODES.length);
    });
});
