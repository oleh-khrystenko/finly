import {
    BILLING_CURRENCY,
    billingGridSchema,
    type BillingGrid,
} from '@finly/types';

/**
 * Sprint 27 — збирає тарифну сітку двох всесвітів з `.env` (єдине джерело
 * значень) у типізований `BillingGrid`. Ціни у `.env` — цілі ГРИВНІ, тут
 * конвертуються у копійки (×100); кредити і ГБ — сирі числа. Fail-fast: будь-яка
 * малформована змінна або невалідна сітка (несортовані пакети, критичний поріг
 * вищий за низький) крашить процес на старті, як і решта env.
 *
 * Формати рядків (той самий делімітер-патерн, що `AUTH_LOCKOUT_THRESHOLDS`):
 *  - `BILLING_DOC_TIERS="1:299:1000,5:1495:5000,10:2990:10000"` — `size:priceGrn:credits`
 *  - `BILLING_DOC_CREDIT_PACKS="500:150,2000:500"` — `credits:priceGrn`
 */

const GRN_TO_KOPECKS = 100;

function parseNonNegativeInt(raw: string, ctx: string): number {
    const value = raw.trim();
    if (!/^\d+$/.test(value)) {
        throw new Error(
            `❌ Billing grid: ${ctx} must be a non-negative integer (got "${raw}")`
        );
    }
    return Number(value);
}

function parseDocTiers(raw: string): BillingGrid['documents']['tiers'] {
    return raw
        .split(',')
        .filter((e) => e.trim().length > 0)
        .map((entry, i) => {
            const parts = entry.split(':');
            if (parts.length !== 3) {
                throw new Error(
                    `❌ BILLING_DOC_TIERS entry #${i + 1} must be "size:priceGrn:credits" (got "${entry}")`
                );
            }
            return {
                size: parseNonNegativeInt(
                    parts[0],
                    `BILLING_DOC_TIERS[${i}].size`
                ),
                priceAmount:
                    parseNonNegativeInt(
                        parts[1],
                        `BILLING_DOC_TIERS[${i}].priceGrn`
                    ) * GRN_TO_KOPECKS,
                monthlyCredits: parseNonNegativeInt(
                    parts[2],
                    `BILLING_DOC_TIERS[${i}].credits`
                ),
            };
        });
}

function parseCreditPacks(
    raw: string
): BillingGrid['documents']['creditPacks'] {
    return raw
        .split(',')
        .filter((e) => e.trim().length > 0)
        .map((entry, i) => {
            const parts = entry.split(':');
            if (parts.length !== 2) {
                throw new Error(
                    `❌ BILLING_DOC_CREDIT_PACKS entry #${i + 1} must be "credits:priceGrn" (got "${entry}")`
                );
            }
            return {
                credits: parseNonNegativeInt(
                    parts[0],
                    `BILLING_DOC_CREDIT_PACKS[${i}].credits`
                ),
                priceAmount:
                    parseNonNegativeInt(
                        parts[1],
                        `BILLING_DOC_CREDIT_PACKS[${i}].priceGrn`
                    ) * GRN_TO_KOPECKS,
            };
        });
}

export function parseBillingGrid(
    getEnvVar: (name: string) => string
): BillingGrid {
    const grid = {
        currency: BILLING_CURRENCY,
        brand: {
            pricePerBusiness:
                parseNonNegativeInt(
                    getEnvVar('BILLING_BRAND_PRICE_PER_BUSINESS'),
                    'BILLING_BRAND_PRICE_PER_BUSINESS'
                ) * GRN_TO_KOPECKS,
        },
        documents: {
            tiers: parseDocTiers(getEnvVar('BILLING_DOC_TIERS')),
            storageGbPerBusiness: parseNonNegativeInt(
                getEnvVar('BILLING_DOC_STORAGE_GB_PER_BUSINESS'),
                'BILLING_DOC_STORAGE_GB_PER_BUSINESS'
            ),
            storageRentCreditsPerGb: parseNonNegativeInt(
                getEnvVar('BILLING_DOC_STORAGE_RENT_CREDITS_PER_GB'),
                'BILLING_DOC_STORAGE_RENT_CREDITS_PER_GB'
            ),
            creditPacks: parseCreditPacks(
                getEnvVar('BILLING_DOC_CREDIT_PACKS')
            ),
            lowBalanceThreshold: parseNonNegativeInt(
                getEnvVar('BILLING_DOC_LOW_BALANCE_THRESHOLD'),
                'BILLING_DOC_LOW_BALANCE_THRESHOLD'
            ),
            criticalBalanceThreshold: parseNonNegativeInt(
                getEnvVar('BILLING_DOC_CRITICAL_BALANCE_THRESHOLD'),
                'BILLING_DOC_CRITICAL_BALANCE_THRESHOLD'
            ),
        },
    };

    const result = billingGridSchema.safeParse(grid);
    if (!result.success) {
        throw new Error(
            `❌ Invalid billing grid config: ${result.error.issues
                .map((e) => `${e.path.join('.')}: ${e.message}`)
                .join('; ')}`
        );
    }
    return result.data;
}
