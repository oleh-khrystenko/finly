import { Injectable } from '@nestjs/common';
import {
    ONE_OFF_ACCESSES,
    SUBSCRIPTION_PLANS,
    type OneOffAccessItem,
    type PaymentsCatalog,
    type SubscriptionPlanItem,
} from '@finly/types';
import { ENV } from '../../config/env';

/**
 * Sprint 17 — каталог зі статичного типізованого конфігу (`@finly/types`).
 * Sprint 22 — ЦІНА стала env-керованою і живе тут, у єдиній точці: структуру
 * (коди, рівні, інтервал, назви) дає `@finly/types`, а `priceAmount` накладається
 * з ENV (гривні → копійки ×100). Це джерело ціни для ВСЬОГО продукту: і публічний
 * `GET /payments/catalog` (web рендерить з нього), і сума реального списання у
 * `PaymentsService` беруть ціну звідси. `priceAmount` у `@finly/types` лишається
 * лише структурним дефолтом і у рантаймі не використовується.
 */
@Injectable()
export class CatalogService {
    getCatalog(): PaymentsCatalog {
        return {
            subscriptionPlans: SUBSCRIPTION_PLANS.map((p) =>
                this.withSubscriptionPrice(p)
            ),
            oneOffAccesses: ONE_OFF_ACCESSES.map((a) =>
                this.withOneOffPrice(a)
            ),
        };
    }

    /** Тариф підписки з env-ціною (або undefined для невідомого коду). */
    getSubscriptionPlan(code: string): SubscriptionPlanItem | undefined {
        const base = SUBSCRIPTION_PLANS.find((p) => p.code === code);
        return base ? this.withSubscriptionPrice(base) : undefined;
    }

    /** One-off доступ з env-ціною (або undefined для невідомого коду). */
    getOneOffAccess(code: string): OneOffAccessItem | undefined {
        const base = ONE_OFF_ACCESSES.find((a) => a.code === code);
        return base ? this.withOneOffPrice(base) : undefined;
    }

    private withSubscriptionPrice(
        item: SubscriptionPlanItem
    ): SubscriptionPlanItem {
        return { ...item, priceAmount: this.subscriptionKopecks(item.code) };
    }

    private withOneOffPrice(item: OneOffAccessItem): OneOffAccessItem {
        return { ...item, priceAmount: this.oneOffKopecks(item.code) };
    }

    private subscriptionKopecks(code: SubscriptionPlanItem['code']): number {
        const grn =
            code === 'brand'
                ? ENV.BILLING_PRICE_SUBSCRIPTION_BRAND
                : ENV.BILLING_PRICE_SUBSCRIPTION_BOOKKEEPER;
        return grn * 100;
    }

    private oneOffKopecks(code: OneOffAccessItem['code']): number {
        const grn =
            code === 'brand'
                ? ENV.BILLING_PRICE_ONEOFF_BRAND
                : ENV.BILLING_PRICE_ONEOFF_BOOKKEEPER;
        return grn * 100;
    }
}
