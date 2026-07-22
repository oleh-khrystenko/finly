import {
    billingGridSchema,
    brandMonthlyAmount,
    documentsMonthlyAmount,
    documentsMonthlyCredits,
    documentsPerBusinessAmount,
    findDocumentsTierBySize,
    monthlyChargeAmount,
    proratedShare,
    storageGbForBusinesses,
    suggestCheaperDocumentsTier,
    type BillingGrid,
    type DocumentsUniverseConfig,
} from './billing-grid';

// Плейсхолдер-сітка у копійках (grn ×100), дзеркалить поточні узгоджені числа:
// Бренд 49 грн/бізнес; Документи 299 грн/бізнес лінійно (5/10/… = size×299).
const GRID: BillingGrid = {
    currency: 'UAH',
    brand: { pricePerBusiness: 4900 },
    documents: {
        tiers: [
            { size: 1, priceAmount: 29900, monthlyCredits: 1000 },
            { size: 5, priceAmount: 149500, monthlyCredits: 5000 },
            { size: 10, priceAmount: 299000, monthlyCredits: 10000 },
            { size: 20, priceAmount: 598000, monthlyCredits: 20000 },
            { size: 50, priceAmount: 1495000, monthlyCredits: 50000 },
            { size: 100, priceAmount: 2990000, monthlyCredits: 100000 },
        ],
        storageGbPerBusiness: 5,
        storageRentCreditsPerGb: 10,
        creditPacks: [
            { credits: 500, priceAmount: 15000 },
            { credits: 2000, priceAmount: 50000 },
        ],
        lowBalanceThreshold: 200,
        criticalBalanceThreshold: 100,
    },
};

describe('billingGridSchema validation', () => {
    it('приймає валідну сітку', () => {
        expect(() => billingGridSchema.parse(GRID)).not.toThrow();
    });

    it('відхиляє незростаючі / неунікальні розміри пакетів', () => {
        const bad = {
            ...GRID,
            documents: {
                ...GRID.documents,
                tiers: [
                    { size: 5, priceAmount: 149500, monthlyCredits: 5000 },
                    { size: 1, priceAmount: 29900, monthlyCredits: 1000 },
                ],
            },
        };
        expect(() => billingGridSchema.parse(bad)).toThrow(/sorted by size/);
    });

    it('відхиляє критичний поріг вищий за низький', () => {
        const bad = {
            ...GRID,
            documents: {
                ...GRID.documents,
                lowBalanceThreshold: 100,
                criticalBalanceThreshold: 200,
            },
        };
        expect(() => billingGridSchema.parse(bad)).toThrow(/criticalBalance/);
    });

    it('відхиляє нульову/відʼємну ціну за бізнес', () => {
        expect(() =>
            billingGridSchema.parse({
                ...GRID,
                brand: { pricePerBusiness: 0 },
            })
        ).toThrow();
    });
});

describe('brandMonthlyAmount', () => {
    it.each([
        [0, 0],
        [1, 4900],
        [2, 9800],
        [3, 14700],
        [10, 49000],
    ])('ємність %i → %i копійок', (capacity, expected) => {
        expect(brandMonthlyAmount(GRID.brand, capacity)).toBe(expected);
    });

    it('кидає на нецілій/відʼємній ємності', () => {
        expect(() => brandMonthlyAmount(GRID.brand, -1)).toThrow();
        expect(() => brandMonthlyAmount(GRID.brand, 1.5)).toThrow();
    });
});

describe('documentsMonthlyAmount / credits', () => {
    it.each([
        [null, 0, 0],
        [1, 29900, 1000],
        [5, 149500, 5000],
        [10, 299000, 10000],
        [20, 598000, 20000],
        [50, 1495000, 50000],
        [100, 2990000, 100000],
    ])('пакет %s → сума %i, кредити %i', (size, amount, credits) => {
        expect(
            documentsMonthlyAmount(GRID.documents, size as number | null)
        ).toBe(amount);
        expect(
            documentsMonthlyCredits(GRID.documents, size as number | null)
        ).toBe(credits);
    });

    it('кидає на невідомому розмірі пакета', () => {
        expect(() => documentsMonthlyAmount(GRID.documents, 7)).toThrow(
            /Unknown documents tier/
        );
        expect(() => documentsMonthlyCredits(GRID.documents, 7)).toThrow(
            /Unknown documents tier/
        );
    });
});

describe('monthlyChargeAmount — сума обох складів', () => {
    it.each([
        [{ brandCapacity: 0, documentsTierSize: null }, 0],
        [{ brandCapacity: 3, documentsTierSize: null }, 14700],
        [{ brandCapacity: 0, documentsTierSize: 10 }, 299000],
        [{ brandCapacity: 2, documentsTierSize: 5 }, 9800 + 149500],
    ] as const)('%o → %i', (warehouses, expected) => {
        expect(monthlyChargeAmount(GRID, warehouses)).toBe(expected);
    });
});

describe('findDocumentsTierBySize', () => {
    it('знаходить наявний, undefined для відсутнього', () => {
        expect(findDocumentsTierBySize(GRID.documents, 10)?.size).toBe(10);
        expect(findDocumentsTierBySize(GRID.documents, 7)).toBeUndefined();
    });
});

describe('suggestCheaperDocumentsTier', () => {
    it('плоска сітка (лінійна) — підказки немає для жодного пакета', () => {
        for (const t of GRID.documents.tiers) {
            expect(
                suggestCheaperDocumentsTier(GRID.documents, t.size)
            ).toBeNull();
        }
    });

    it('оптова знижка на 10 → підказка з пакета 5 на 10', () => {
        const discounted: DocumentsUniverseConfig = {
            ...GRID.documents,
            tiers: GRID.documents.tiers.map((t) =>
                t.size === 10
                    ? { ...t, priceAmount: 200000 } // 20000/бізнес < 29900
                    : t
            ),
        };
        const hint = suggestCheaperDocumentsTier(discounted, 5);
        expect(hint?.size).toBe(10);
        // Найменший вигідніший, не найбільший.
        expect(documentsPerBusinessAmount(hint!)).toBeLessThan(
            documentsPerBusinessAmount(findDocumentsTierBySize(discounted, 5)!)
        );
    });

    it('невідомий поточний розмір → null', () => {
        expect(suggestCheaperDocumentsTier(GRID.documents, 7)).toBeNull();
    });
});

describe('storageGbForBusinesses', () => {
    it.each([
        [0, 0],
        [1, 5],
        [10, 50],
    ])('%i бізнесів → %i ГБ', (count, gb) => {
        expect(storageGbForBusinesses(GRID.documents, count)).toBe(gb);
    });
});

describe('proratedShare', () => {
    it.each([
        // full, remaining, inCycle → expected (округлення до копійки)
        [29900, 30, 30, 29900], // повний цикл на старті
        [29900, 0, 30, 0], // останній день
        [29900, 15, 30, 14950], // половина
        [29900, 10, 30, 9967], // третина, округлення
        [4900, 15, 30, 2450], // Бренд поштучно, половина
        [149500, 7, 31, 33758], // 31-денний цикл
    ])(
        'full=%i remaining=%i inCycle=%i → %i',
        (full, remaining, inCycle, expected) => {
            expect(proratedShare(full, remaining, inCycle)).toBe(expected);
        }
    );

    it('клемпить дні понад цикл до повної суми', () => {
        expect(proratedShare(29900, 40, 30)).toBe(29900);
    });

    it('кидає на нульовому циклі і нецілих входах', () => {
        expect(() => proratedShare(29900, 5, 0)).toThrow();
        expect(() => proratedShare(29900, 5.5, 30)).toThrow();
        expect(() => proratedShare(-1, 5, 30)).toThrow();
    });
});
