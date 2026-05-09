/**
 * Sprint 4 review fix — server-side expiry-check для public payment-flow.
 *
 * **Контракт:**
 *  - `validUntil === null` → ніколи не expired (інвойс без терміну дії).
 *  - `validUntil < now` → expired (точка `=== now` ще active, дзеркало
 *    `getInvoiceStatus` на frontend `entities/invoice/formatKopecks`).
 *
 * Pure-функція без I/O. `now` параметр — для testability (default
 * `Date.now()`); production-call-site не передає, бо single-shot per request.
 *
 * Раніше expiry-check жив тільки на frontend (`InvoicePublicView` ховав
 * payment-CTA-и, але `nbuLinks` все одно віддавалися у JSON). Тепер це
 * source of truth для серверного блоку: `PublicInvoicesController` ставить
 * `nbuLinks: null` у JSON-view і кидає 410 Gone на QR endpoints — клієнт
 * фізично не отримує payment-vector після терміну.
 */
export function isInvoiceExpired(
    validUntil: Date | null,
    now: number = Date.now()
): boolean {
    if (validUntil === null) return false;
    return validUntil.getTime() < now;
}
