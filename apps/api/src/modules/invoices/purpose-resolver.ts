/**
 * Sprint 4 §4.1 — pure resolver для inheritance-rule
 * `invoice.paymentPurpose ?? business.paymentPurposeTemplate`.
 *
 * **Single helper** для двох call-sites, що повинні залишатись синхронними:
 *  - `InvoiceSlugGeneratorService` (preset `with-purpose` — slugifies effective
 *    purpose у URL).
 *  - `payload-mapper.ts` (NBU payload `purpose` field — фактичний текст для
 *    банк-додатку).
 *
 * Якщо два call-sites дрейфнуть на одному й тому ж resolution-rule — slug у
 * URL покаже одне, а банк-додаток отримає інше. Тому resolver — окремий
 * pure-helper, без DI / без mocks.
 *
 * **Контракт.** `invoicePaymentPurpose` — **те, що зберіг ФОП у документі**
 * (не post-resolve). `null` ⇒ inheritance signal. Будь-який non-null string
 * (включно з технічно невалідними `''` чи whitespace-only — їх блокує Sprint 1
 * Zod-entity на write-side; resolver не дублює перевірку — pure-helper за
 * контрактом сирий passthrough non-null).
 *
 * **`businessPaymentPurposeTemplate` — required non-empty string.** Sprint 1
 * Zod entity (`Business.paymentPurposeTemplate.min(1)`) гарантує наявність
 * non-empty bottom-string на любому шляху, що читає `Business`-документ; цей
 * resolver покладається на цей invariant.
 */
export function effectiveInvoicePurpose(
    invoicePaymentPurpose: string | null,
    businessPaymentPurposeTemplate: string
): string {
    return invoicePaymentPurpose ?? businessPaymentPurposeTemplate;
}
