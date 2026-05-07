/**
 * Sprint 4 review fix — фінансовий boundary parser для UA UX.
 *
 * **Проблема, яку це закриває.** UI рендерить гривні через `Intl.NumberFormat
 * ('uk-UA')` з комою як decimal-separator (`1 500,50 ₴` — стандарт UA-фінансів),
 * але raw `<input type="number">` + `Number.parseFloat` приймає лише `.` і
 * залежно від browser locale може silently re-interpret-увати `1500,50` як
 * `1500` (втрата 50 копійок) або взагалі відмовляти.
 *
 * **Контракт.** Приймає рядок з UA-форматом (кома **АБО** крапка як decimal
 * separator, optional whitespace/NBSP-thousands), повертає копійки (int
 * ≥ 0) або `null` для empty input. Кидає помилку для невалідного формату —
 * caller перетворює у user-facing error.
 *
 * **Правила:**
 *  - Empty / whitespace-only → `null` (signage-mode "клієнт сам вводить").
 *  - Кома і крапка взаємозамінні як decimal separator (`1500,50` = `1500.50`).
 *  - Максимум 2 знаки після separator-а (копійки). 3+ — `INVALID_AMOUNT_PRECISION`.
 *  - Тільки один separator allowed: `1.500,50` (european thousands+decimal) —
 *    invalid format. Українські banking-форми зазвичай не використовують
 *    thousands-separator у input-полях.
 *  - NBSP/space — strip-аются (тримаючи pasting із форматованих джерел).
 *  - Negative / non-numeric → `INVALID_AMOUNT_FORMAT`.
 *
 * **Чому окремий util.** Той самий парсер використовується у
 * `CreateInvoiceForm` і `AmountSection` — без shared-extraction вони drift-уть
 * у тонкощах (один прийме `1500,50`, інший — ні).
 */

export type MoneyParseError =
    | 'INVALID_AMOUNT_FORMAT'
    | 'INVALID_AMOUNT_PRECISION'
    | 'INVALID_AMOUNT_NEGATIVE';

export type MoneyParseResult =
    | { ok: true; kopecks: number | null }
    | { ok: false; error: MoneyParseError };

/**
 * Парсить user-input рядок у копійки.
 * `null` → signage-mode "сума вводиться у банку".
 */
export function parseUaMoney(raw: string): MoneyParseResult {
    // Strip whitespace + NBSP (U+00A0) — користувач міг вставити з
    // formatted-displaying ("1 500,50 ₴" → стандартні Intl-thousands).
    const cleaned = raw.replace(/[\s ₴]/g, '');
    if (cleaned === '') return { ok: true, kopecks: null };

    if (cleaned.startsWith('-')) {
        return { ok: false, error: 'INVALID_AMOUNT_NEGATIVE' };
    }

    // Один separator allowed (комa або крапка). Two separators → invalid
    // (european-style thousands+decimal — ambiguous, не підтримуємо).
    const sepCount = (cleaned.match(/[.,]/g) ?? []).length;
    if (sepCount > 1) return { ok: false, error: 'INVALID_AMOUNT_FORMAT' };

    const normalized = cleaned.replace(',', '.');
    if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
        return { ok: false, error: 'INVALID_AMOUNT_FORMAT' };
    }

    const [intPart, fracPart = ''] = normalized.split('.');
    if (fracPart.length > 2) {
        return { ok: false, error: 'INVALID_AMOUNT_PRECISION' };
    }

    const padded = (fracPart + '00').slice(0, 2);
    const kopecks = Number(intPart) * 100 + Number(padded);
    if (!Number.isFinite(kopecks) || !Number.isSafeInteger(kopecks)) {
        return { ok: false, error: 'INVALID_AMOUNT_FORMAT' };
    }
    return { ok: true, kopecks };
}

/**
 * Зворотна операція — копійки → display-string для edit-mode (`1500,50`).
 * Використовуємо кому — щоб user-input і UI consistency була у одному
 * separator. Empty kopecks (signage) → empty string.
 */
export function formatKopecksForInput(kopecks: number | null): string {
    if (kopecks === null) return '';
    const hryvnia = Math.floor(kopecks / 100);
    const k = kopecks % 100;
    return `${hryvnia},${k.toString().padStart(2, '0')}`;
}
