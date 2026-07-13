import { Injectable } from '@nestjs/common';
import { type BillingCatalog } from '@finly/types';
import { ENV } from '../../config/env';

/**
 * Sprint 27 — публічний каталог двох всесвітів з тарифної сітки (`.env`). Ціни,
 * розміри пакетів, обсяги кредитів і ГБ — усі з `ENV.BILLING_GRID` (єдине
 * джерело). `enabled`-прапори: Бренд продається одразу, Документи під прапором
 * «скоро». Приховані пакети докупівлі кредитів сюди НЕ входять — контекстні.
 */
@Injectable()
export class CatalogService {
    private readonly grid = ENV.BILLING_GRID;

    getCatalog(): BillingCatalog {
        const docs = this.grid.documents;
        return {
            currency: this.grid.currency,
            brand: {
                enabled: ENV.BILLING_BRAND_ENABLED,
                pricePerBusiness: this.grid.brand.pricePerBusiness,
            },
            documents: {
                enabled: ENV.BILLING_DOCUMENTS_ENABLED,
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
