import { Injectable } from '@nestjs/common';
import { type BillingCatalog } from '@finly/types';
import {
    BILLING_GRID,
    BILLING_UNIVERSE_ENABLED,
} from '../../config/billing.config';

/**
 * Sprint 27 — публічний каталог двох всесвітів з тарифної сітки. Ціни,
 * розміри пакетів, обсяги кредитів і ГБ — усі з `BILLING_GRID` (єдине
 * джерело). `enabled`-прапори: Бренд продається одразу, Документи під прапором
 * «скоро». Приховані пакети докупівлі кредитів сюди НЕ входять — контекстні.
 */
@Injectable()
export class CatalogService {
    private readonly grid = BILLING_GRID;

    getCatalog(): BillingCatalog {
        const docs = this.grid.documents;
        return {
            currency: this.grid.currency,
            brand: {
                enabled: BILLING_UNIVERSE_ENABLED.brand,
                pricePerBusiness: this.grid.brand.pricePerBusiness,
            },
            documents: {
                enabled: BILLING_UNIVERSE_ENABLED.documents,
                tiers: docs.tiers.map((t) => ({
                    size: t.size,
                    priceAmount: t.priceAmount,
                    monthlyCredits: t.monthlyCredits,
                    storageGb: docs.storageGbPerBusiness * t.size,
                })),
                storageGbPerBusiness: docs.storageGbPerBusiness,
                storageRentCreditsPerGb: docs.storageRentCreditsPerGb,
                lowBalanceThreshold: docs.lowBalanceThreshold,
                criticalBalanceThreshold: docs.criticalBalanceThreshold,
            },
        };
    }
}
