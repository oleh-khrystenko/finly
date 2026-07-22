import { z } from 'zod';

/**
 * Sprint 27 — тарифна сітка двох всесвітів як чиста, host-agnostic механіка.
 *
 * ДЖЕРЕЛО ЗНАЧЕНЬ — `.env` (fail-fast loader на боці API збирає `BillingGrid` з
 * env-рядків). Тут живе лише СТРУКТУРА (форма конфігу) і ЧИСТІ ФУНКЦІЇ ціни та
 * пропорції. Жодного числа-плейсхолдера у коді: змінити ціну, розмір пакета,
 * обсяг кредитів чи поріг — це відредагувати `.env` і перезапустити API.
 *
 * Два всесвіти монетизації, що ніде не перетинаються:
 *  - **Бренд** (власник): slug + логотип. Ціна поштучна за бізнес, без пакетів і
 *    без оптової знижки — ємність довільна, місячна сума = ціна × кількість
 *    прикріплених бізнесів.
 *  - **Документи** (бухгалтер): дискретні пакети фіксованих розмірів
 *    (1/5/10/…). Пакет визначає ємність (скільки бізнесів покриває), місячну
 *    ціну і місячний обсяг кредитів (top-up-to-cap). Сховище — базові ГБ на
 *    бізнес; понадбазові ГБ коштують місячну ренту кредитами.
 *
 * Гроші — копійки (integer), як і решта білінгу. Проміжних float-обчислень над
 * грошима немає: пропорція округлюється до цілої копійки в одному місці.
 */

export const BILLING_UNIVERSE = {
    BRAND: 'brand',
    DOCUMENTS: 'documents',
} as const;

export type BillingUniverse =
    (typeof BILLING_UNIVERSE)[keyof typeof BILLING_UNIVERSE];

export const BILLING_UNIVERSES = [
    BILLING_UNIVERSE.BRAND,
    BILLING_UNIVERSE.DOCUMENTS,
] as const;

// ── Config shape (значення інжектяться з env; тут — лише форма) ───────────────

/**
 * Прихований пакет докупівлі кредитів. Публічно не продається, з'являється
 * контекстно на порогах балансу. Ті самі копійки-integer.
 */
export const creditPackSchema = z.object({
    credits: z.number().int().positive(),
    priceAmount: z.number().int().positive(), // копійки
});
export type CreditPack = z.infer<typeof creditPackSchema>;

/** Всесвіт «Бренд»: поштучна ціна за бізнес, без пакетів. */
export const brandUniverseConfigSchema = z.object({
    /** Місячна ціна одного прикріпленого бізнесу, копійки. */
    pricePerBusiness: z.number().int().positive(),
});
export type BrandUniverseConfig = z.infer<typeof brandUniverseConfigSchema>;

/** Один дискретний пакет документного всесвіту. */
export const documentsTierSchema = z.object({
    /** Ємність пакета — скільки бізнесів покриває. */
    size: z.number().int().positive(),
    /** Місячна ціна пакета, копійки. */
    priceAmount: z.number().int().positive(),
    /** Місячний обсяг кредитів (top-up-to-cap до цього значення). */
    monthlyCredits: z.number().int().positive(),
});
export type DocumentsTier = z.infer<typeof documentsTierSchema>;

export const documentsUniverseConfigSchema = z.object({
    /** Пакети за зростанням розміру, розміри унікальні (див. refine у grid). */
    tiers: z.array(documentsTierSchema).min(1),
    /** Базовий ліміт сховища на один бізнес, ГБ. */
    storageGbPerBusiness: z.number().int().positive(),
    /** Місячна рента кредитами за кожен ГБ понад базовий ліміт. */
    storageRentCreditsPerGb: z.number().int().nonnegative(),
    /** Приховані пакети докупівлі кредитів. */
    creditPacks: z.array(creditPackSchema).min(1),
    /** Поріг «мало кредитів» — показ блоку докупівлі. */
    lowBalanceThreshold: z.number().int().nonnegative(),
    /** Поріг «критично мало» — додаткова інфо-плашка. */
    criticalBalanceThreshold: z.number().int().nonnegative(),
});
export type DocumentsUniverseConfig = z.infer<
    typeof documentsUniverseConfigSchema
>;

export const billingGridSchema = z
    .object({
        currency: z.string(),
        brand: brandUniverseConfigSchema,
        documents: documentsUniverseConfigSchema,
    })
    .superRefine((grid, ctx) => {
        const sizes = grid.documents.tiers.map((t) => t.size);
        const sorted = [...sizes].every((s, i) => i === 0 || sizes[i - 1] < s);
        if (!sorted) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['documents', 'tiers'],
                message:
                    'documents.tiers must be sorted by size ascending with unique sizes',
            });
        }
        if (
            grid.documents.criticalBalanceThreshold >
            grid.documents.lowBalanceThreshold
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['documents', 'criticalBalanceThreshold'],
                message:
                    'criticalBalanceThreshold must not exceed lowBalanceThreshold',
            });
        }
    });
export type BillingGrid = z.infer<typeof billingGridSchema>;

// ── Pure pricing ─────────────────────────────────────────────────────────────

/** Місячна сума Бренд-складу за ємність (кількість слотів), копійки. */
export function brandMonthlyAmount(
    cfg: BrandUniverseConfig,
    capacity: number
): number {
    assertNonNegativeInt(capacity, 'capacity');
    return cfg.pricePerBusiness * capacity;
}

/** Пакет документів за точним розміром, або undefined якщо такого немає. */
export function findDocumentsTierBySize(
    cfg: DocumentsUniverseConfig,
    size: number
): DocumentsTier | undefined {
    return cfg.tiers.find((t) => t.size === size);
}

/**
 * Місячна сума документного складу за розміром активного пакета, копійки.
 * `null` (немає документного пакета) → 0.
 */
export function documentsMonthlyAmount(
    cfg: DocumentsUniverseConfig,
    tierSize: number | null
): number {
    if (tierSize === null) return 0;
    const tier = findDocumentsTierBySize(cfg, tierSize);
    if (!tier) {
        throw new Error(`Unknown documents tier size: ${tierSize}`);
    }
    return tier.priceAmount;
}

/** Місячний обсяг кредитів документного пакета; `null` → 0. */
export function documentsMonthlyCredits(
    cfg: DocumentsUniverseConfig,
    tierSize: number | null
): number {
    if (tierSize === null) return 0;
    const tier = findDocumentsTierBySize(cfg, tierSize);
    if (!tier) {
        throw new Error(`Unknown documents tier size: ${tierSize}`);
    }
    return tier.monthlyCredits;
}

/**
 * Чиста місячна сума списання платника = сума обох складів. Це і є інваріант
 * «сума наступного списання завжди дорівнює функції від ємностей складів»: без
 * боргів, без донарахувань циклу.
 */
export function monthlyChargeAmount(
    grid: BillingGrid,
    warehouses: {
        brandCapacity: number;
        documentsTierSize: number | null;
    }
): number {
    return (
        brandMonthlyAmount(grid.brand, warehouses.brandCapacity) +
        documentsMonthlyAmount(grid.documents, warehouses.documentsTierSize)
    );
}

/** Ціна одного бізнесу у пакеті документів (для підказки вигіднішого пакета). */
export function documentsPerBusinessAmount(tier: DocumentsTier): number {
    return tier.priceAmount / tier.size;
}

/**
 * Підказка вигіднішого пакета: найменший більший пакет зі строго нижчою ціною
 * за бізнес, ніж поточний. Поки сітка плоска (лінійна ціна) — не спрацьовує;
 * щойно в `.env` з'явиться оптова знижка, підказка ожива без зміни коду.
 */
export function suggestCheaperDocumentsTier(
    cfg: DocumentsUniverseConfig,
    currentSize: number
): DocumentsTier | null {
    const current = findDocumentsTierBySize(cfg, currentSize);
    if (!current) return null;
    const currentPerBusiness = documentsPerBusinessAmount(current);
    for (const tier of cfg.tiers) {
        if (
            tier.size > currentSize &&
            documentsPerBusinessAmount(tier) < currentPerBusiness
        ) {
            return tier;
        }
    }
    return null;
}

/** Базовий ліміт сховища для N бізнесів, ГБ. */
export function storageGbForBusinesses(
    cfg: DocumentsUniverseConfig,
    businessCount: number
): number {
    assertNonNegativeInt(businessCount, 'businessCount');
    return cfg.storageGbPerBusiness * businessCount;
}

// ── Pure proration ───────────────────────────────────────────────────────────

/**
 * Пропорційна частка місячної суми за дні, що лишились до кінця циклу. Чиста
 * ціле-число-математика над копійками з єдиним округленням до найближчої
 * копійки. Використовується і для негайної доплати при збільшенні ємності, і
 * (тими самими днями) для частки кредитів — симетрія «доплата і кредити з однієї
 * частки циклу».
 *
 * `daysRemaining` клемпиться у [0, daysInCycle]: дія в останній день дає майже
 * повний нуль, дія в перший — майже повну суму, поза межами — клемп.
 */
export function proratedShare(
    fullAmount: number,
    daysRemaining: number,
    daysInCycle: number
): number {
    assertNonNegativeInt(fullAmount, 'fullAmount');
    assertPositiveInt(daysInCycle, 'daysInCycle');
    assertNonNegativeInt(daysRemaining, 'daysRemaining');
    const clamped = Math.min(daysRemaining, daysInCycle);
    return Math.round((fullAmount * clamped) / daysInCycle);
}

// ── Guards ───────────────────────────────────────────────────────────────────

function assertNonNegativeInt(value: number, name: string): void {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(
            `${name} must be a non-negative integer (got ${value})`
        );
    }
}

function assertPositiveInt(value: number, name: string): void {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer (got ${value})`);
    }
}
