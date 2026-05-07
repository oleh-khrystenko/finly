/**
 * Sprint 4 §4.4 — конвертація `amount` (копійки, int) → відображення для UI.
 *
 * **Чому окремий util.** Cabinet-list (`InvoiceCard`), public-сторінка
 * (Sprint 4 §4.7) і invoice-кабінет (§4.6) усі рендерять той самий формат.
 * Дрейф ("1500 грн" vs "1500,00 ₴" vs "1 500.00 UAH") порушує UX-узгодженість.
 *
 * **`Intl.NumberFormat('uk-UA')`** — використовуємо locale-aware тисячні
 * розділювачі (NBSP) і десяткову кому — як прийнято в УКР-фінансовому UX
 * (бухгалтери очікують "1 500,00 ₴").
 *
 * **`null` → null** — caller вирішує fallback ("Без суми", placeholder).
 * Pure-функція без I/O — тестується ізольовано.
 */
const HRYVNIA_FORMATTER = new Intl.NumberFormat('uk-UA', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

export function formatKopecksAsHryvnia(
    kopecks: number | null,
): string | null {
    if (kopecks === null) return null;
    const hryvnia = kopecks / 100;
    return `${HRYVNIA_FORMATTER.format(hryvnia)} ₴`;
}

/**
 * Sprint 4 §4.4 — статус інвойсу для badge-а у `InvoiceCard` і banner-а на
 * public-сторінці §4.7. Single source of truth для "Активний" vs "Прострочено"
 * UI-tag-у.
 *
 * `null` validUntil → завжди "active" (інвойс без терміну дії).
 * `validUntil < now` → "expired".
 *
 * **Контракт**: `validUntil` приходить як `Date` instance — `shared/api/invoices`
 * нормалізує JSON ISO-string → `Date` через Zod-parse на boundary. Defensive
 * `string`-fallback свідомо НЕ підтримується — це маскувало б повернення
 * boundary-bug-у.
 */
export type InvoiceLifecycleStatus = 'active' | 'expired';

export function getInvoiceStatus(
    validUntil: Date | null,
    now: Date = new Date(),
): InvoiceLifecycleStatus {
    if (validUntil === null) return 'active';
    return validUntil.getTime() < now.getTime() ? 'expired' : 'active';
}
