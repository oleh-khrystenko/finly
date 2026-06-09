import { Injectable } from '@nestjs/common';
import { PAYMENTS_CATALOG, type PaymentsCatalog } from '@finly/types';

/**
 * Sprint 17 — каталог переїхав зі Stripe Products у статичний типізований конфіг
 * (`@finly/types`: `PAYMENTS_CATALOG`), єдине джерело істини. Сервіс більше не
 * тримає Stripe-SDK, warm-fetch і Redis-кеш: дані компіл-тайм-константа, кеш
 * над in-memory значенням не має сенсу. Sprint 19 — каталог по цінності
 * (2 підписки + 2 one-off доступи з рівнем), без «виконань».
 */
@Injectable()
export class CatalogService {
    getCatalog(): PaymentsCatalog {
        return {
            subscriptionPlans: [...PAYMENTS_CATALOG.subscriptionPlans],
            oneOffAccesses: [...PAYMENTS_CATALOG.oneOffAccesses],
        };
    }
}
