import {
    BILLING_CURRENCY,
    billingGridSchema,
    type BillingGrid,
} from '@finly/types';

/**
 * Тарифна сітка двох всесвітів — єдине джерело цін, розмірів пакетів, обсягів
 * кредитів, ГБ і порогів. Продуктове рішення, однакове в усіх середовищах, тож
 * живе у коді: зміна ціни чи пакета — це правка тут і деплой.
 *
 * Гроші тримаємо копійками (як і решта білінгу), але записуємо гривнями × 100 —
 * так у діффі видно ту саму цифру, що на вітрині. Кредити і ГБ — сирі числа.
 */

const GRN_TO_KOPECKS = 100;

const grid = {
    currency: BILLING_CURRENCY,
    brand: {
        // Поштучна ціна одного прикріпленого бізнесу, без пакетів і оптової знижки.
        pricePerBusiness: 49 * GRN_TO_KOPECKS,
    },
    documents: {
        // Дискретні пакети за зростанням ємності: скільки бізнесів покриває,
        // місячна ціна, місячний обсяг кредитів.
        tiers: [
            {
                size: 1,
                priceAmount: 299 * GRN_TO_KOPECKS,
                monthlyCredits: 1000,
            },
            {
                size: 5,
                priceAmount: 1495 * GRN_TO_KOPECKS,
                monthlyCredits: 5000,
            },
            {
                size: 10,
                priceAmount: 2990 * GRN_TO_KOPECKS,
                monthlyCredits: 10000,
            },
            {
                size: 20,
                priceAmount: 5980 * GRN_TO_KOPECKS,
                monthlyCredits: 20000,
            },
            {
                size: 50,
                priceAmount: 14950 * GRN_TO_KOPECKS,
                monthlyCredits: 50000,
            },
            {
                size: 100,
                priceAmount: 29900 * GRN_TO_KOPECKS,
                monthlyCredits: 100000,
            },
        ],
        storageGbPerBusiness: 5,
        storageRentCreditsPerGb: 10,
        // Приховані пакети докупівлі: публічно не продаються, з'являються
        // контекстно на порогах балансу.
        creditPacks: [
            { credits: 500, priceAmount: 150 * GRN_TO_KOPECKS },
            { credits: 2000, priceAmount: 500 * GRN_TO_KOPECKS },
        ],
        lowBalanceThreshold: 200,
        criticalBalanceThreshold: 100,
    },
};

const parsedGrid = billingGridSchema.safeParse(grid);
if (!parsedGrid.success) {
    throw new Error(
        `❌ Invalid billing grid config: ${parsedGrid.error.issues
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join('; ')}`
    );
}

export const BILLING_GRID: BillingGrid = parsedGrid.data;

/**
 * Dunning billing-clock: скільки разів пробуємо списати у прострочці до зняття
 * доступу і інтервал між повторами. Грейс ≈ (maxAttempts − 1) × retryInterval,
 * тобто ≈ 9 днів: частий перший повтор ловить швидке поповнення картки, довге
 * вікно перекриває зарплатну хвилю.
 */
export const BILLING_DUNNING = {
    maxAttempts: 10,
    retryIntervalHours: 24,
} as const;

/**
 * Які всесвіти продаються. Бренд — одразу; Документи під прапором «скоро»:
 * механіка будується і тестується, вітрина й checkout вимкнені до запуску.
 */
export const BILLING_UNIVERSE_ENABLED = {
    brand: true,
    documents: false,
} as const;

/**
 * Прострочка мусить мати щонайменше одну спробу і ненульовий інтервал: нуль
 * спроб знімав би доступ миттєво, нульовий інтервал злипав би повтори в один
 * момент — грейс-вікно зникає в обох випадках.
 */
export function validateDunningConfig(
    maxAttempts: number,
    retryIntervalHours: number
): void {
    if (maxAttempts < 1 || retryIntervalHours < 1) {
        throw new Error(
            `❌ BILLING_DUNNING.maxAttempts (${maxAttempts}) and ` +
                `BILLING_DUNNING.retryIntervalHours (${retryIntervalHours}) must both be ≥ 1.`
        );
    }
}

validateDunningConfig(
    BILLING_DUNNING.maxAttempts,
    BILLING_DUNNING.retryIntervalHours
);
