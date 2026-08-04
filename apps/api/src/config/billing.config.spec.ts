import { billingGridSchema } from '@finly/types';

import {
    BILLING_DUNNING,
    BILLING_GRID,
    validateDunningConfig,
} from './billing.config';

describe('billing config', () => {
    it('сітка відповідає контракту BillingGrid', () => {
        expect(() => billingGridSchema.parse(BILLING_GRID)).not.toThrow();
    });

    it('усі ціни — цілі копійки', () => {
        const amounts = [
            BILLING_GRID.brand.pricePerBusiness,
            ...BILLING_GRID.documents.tiers.map((t) => t.priceAmount),
            ...BILLING_GRID.documents.creditPacks.map((p) => p.priceAmount),
        ];
        for (const amount of amounts) {
            expect(Number.isInteger(amount)).toBe(true);
        }
    });

    it('грейс прострочки не коротший за тиждень', () => {
        const graceHours =
            (BILLING_DUNNING.maxAttempts - 1) *
            BILLING_DUNNING.retryIntervalHours;
        expect(graceHours).toBeGreaterThanOrEqual(7 * 24);
    });

    it('відхиляє нульові спроби або нульовий інтервал', () => {
        expect(() => validateDunningConfig(0, 24)).toThrow(/must both be ≥ 1/);
        expect(() => validateDunningConfig(10, 0)).toThrow(/must both be ≥ 1/);
    });
});
