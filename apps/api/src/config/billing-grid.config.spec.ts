import { parseBillingGrid } from './billing-grid.config';

function reader(vars: Record<string, string>): (name: string) => string {
    return (name) => {
        const v = vars[name];
        if (v === undefined) throw new Error(`missing ${name}`);
        return v;
    };
}

const VALID = {
    BILLING_BRAND_PRICE_PER_BUSINESS: '49',
    BILLING_DOC_TIERS:
        '1:299:1000,5:1495:5000,10:2990:10000,20:5980:20000,50:14950:50000,100:29900:100000',
    BILLING_DOC_STORAGE_GB_PER_BUSINESS: '5',
    BILLING_DOC_STORAGE_RENT_CREDITS_PER_GB: '10',
    BILLING_DOC_CREDIT_PACKS: '500:150,2000:500',
    BILLING_DOC_LOW_BALANCE_THRESHOLD: '200',
    BILLING_DOC_CRITICAL_BALANCE_THRESHOLD: '100',
};

describe('parseBillingGrid', () => {
    it('конвертує гривні у копійки, кредити/ГБ лишає сирими', () => {
        const grid = parseBillingGrid(reader(VALID));
        expect(grid.brand.pricePerBusiness).toBe(4900);
        expect(grid.documents.tiers[0]).toEqual({
            size: 1,
            priceAmount: 29900,
            monthlyCredits: 1000,
        });
        expect(grid.documents.tiers[2]).toEqual({
            size: 10,
            priceAmount: 299000,
            monthlyCredits: 10000,
        });
        expect(grid.documents.storageGbPerBusiness).toBe(5);
        expect(grid.documents.creditPacks).toEqual([
            { credits: 500, priceAmount: 15000 },
            { credits: 2000, priceAmount: 50000 },
        ]);
        expect(grid.documents.lowBalanceThreshold).toBe(200);
        expect(grid.documents.criticalBalanceThreshold).toBe(100);
    });

    it('кидає на малформованому пакеті (не три частини)', () => {
        expect(() =>
            parseBillingGrid(
                reader({ ...VALID, BILLING_DOC_TIERS: '1:299,5:1495:5000' })
            )
        ).toThrow(/BILLING_DOC_TIERS entry #1/);
    });

    it('кидає на нечисловому значенні', () => {
        expect(() =>
            parseBillingGrid(
                reader({ ...VALID, BILLING_BRAND_PRICE_PER_BUSINESS: 'abc' })
            )
        ).toThrow(/BILLING_BRAND_PRICE_PER_BUSINESS/);
    });

    it('кидає на малформованому пакеті кредитів', () => {
        expect(() =>
            parseBillingGrid(
                reader({ ...VALID, BILLING_DOC_CREDIT_PACKS: '500' })
            )
        ).toThrow(/BILLING_DOC_CREDIT_PACKS entry #1/);
    });

    it('кидає на невалідній сітці (несортовані пакети)', () => {
        expect(() =>
            parseBillingGrid(
                reader({
                    ...VALID,
                    BILLING_DOC_TIERS: '5:1495:5000,1:299:1000',
                })
            )
        ).toThrow(/Invalid billing grid|sorted by size/);
    });

    it('кидає на критичному порозі вищому за низький', () => {
        expect(() =>
            parseBillingGrid(
                reader({
                    ...VALID,
                    BILLING_DOC_LOW_BALANCE_THRESHOLD: '100',
                    BILLING_DOC_CRITICAL_BALANCE_THRESHOLD: '200',
                })
            )
        ).toThrow(/Invalid billing grid|criticalBalance/);
    });
});
