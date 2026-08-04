// Терміни життя і пороги cron-чисток. Продуктові значення, однакові в усіх
// середовищах — тому в коді, не в `.env` (там лишається конфігурація
// середовища: секрети, адреси, підключення).

/**
 * Скільки днів soft-deleted акаунт лежить у grace-періоді до hard-delete.
 * Те саме число показуємо користувачу в листі й у кабінеті.
 */
export const ACCOUNT_DELETION_GRACE_DAYS = 30;

/**
 * 3-стадійний pipeline для профілів без імені, що мають orphan-бізнес:
 * перший reminder → фінальне попередження → cascade-видалення бізнесів.
 */
export const ORPHAN_CLEANUP = {
    /** Grace-період між створенням бізнесу і першим листом. */
    firstReminderDays: 1,
    finalReminderDays: 6,
    deletionDays: 7,
} as const;

/**
 * Пороги чистки pending-логотипів бренду з R2. Демоутований (колись оплачений)
 * логотип живе довше за ніколи-неоплачений: платник міг згаснути ненадовго, і
 * повторна підписка промотує логотип назад без перезавантаження.
 */
export const BRAND_CLEANUP = {
    pendingDays: 30,
    demotedDays: 90,
} as const;

/**
 * Стадії orphan-pipeline мусять монотонно зростати: first < final < deletion.
 * Інакше вони колапсують в один cron-run (reminder, попередження і видалення
 * в одну добу), і compliance-інваріант «користувача попередили двічі перед
 * видаленням» ламається. first ≥ 1 — мінімальний grace між створенням бізнесу
 * і першим листом: нульовий поріг слав би лист раніше за перший вхід у кабінет.
 */
export function validateOrphanCleanupSchedule(
    firstDays: number,
    finalDays: number,
    deletionDays: number
): void {
    if (!Number.isInteger(firstDays) || firstDays < 1) {
        throw new Error(
            `❌ ORPHAN_CLEANUP.firstReminderDays must be an integer ≥ 1 (got ${firstDays}).`
        );
    }
    if (!Number.isInteger(finalDays) || !Number.isInteger(deletionDays)) {
        throw new Error(
            `❌ ORPHAN_CLEANUP.finalReminderDays and ORPHAN_CLEANUP.deletionDays must be integers ` +
                `(got ${finalDays}, ${deletionDays}).`
        );
    }
    if (!(firstDays < finalDays && finalDays < deletionDays)) {
        throw new Error(
            `❌ Orphan-cleanup schedule must satisfy ` +
                `firstReminderDays < finalReminderDays < deletionDays ` +
                `(got ${firstDays} < ${finalDays} < ${deletionDays}). ` +
                'Otherwise email-pipeline stages overlap and "user warned twice before deletion" invariant breaks.'
        );
    }
}

/**
 * Демоутований платний логотип не може чиститись раніше за неоплачений free —
 * інверсія порогів прибирала б файли платника тихо і без падіння.
 */
export function validateBrandCleanupThresholds(
    pendingDays: number,
    demotedDays: number
): void {
    if (pendingDays > demotedDays) {
        throw new Error(
            `❌ BRAND_CLEANUP.pendingDays (${pendingDays}) must not exceed ` +
                `BRAND_CLEANUP.demotedDays (${demotedDays}). Demoted (paid) ` +
                'logos must get at least as long a grace window as unpaid free uploads.'
        );
    }
}

validateOrphanCleanupSchedule(
    ORPHAN_CLEANUP.firstReminderDays,
    ORPHAN_CLEANUP.finalReminderDays,
    ORPHAN_CLEANUP.deletionDays
);

validateBrandCleanupThresholds(
    BRAND_CLEANUP.pendingDays,
    BRAND_CLEANUP.demotedDays
);
