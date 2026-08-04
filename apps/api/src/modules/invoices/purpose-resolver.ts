/**
 * Sprint 4 §4.1 — pure resolver для inheritance-rule
 * `invoice.paymentPurpose ?? <успадкований шаблон>`.
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
 * **Sprint 29 — успадкування трирівневе: `invoice → account → business`.**
 * Другий аргумент — вже resolved шаблон рівнем нижче
 * (`resolveAccountPurposeTemplate(business, account)`), а не сирий
 * `business.paymentPurposeTemplate`. Причина: рахунок отримав власний
 * `paymentPurposeTemplate` (один отримувач тримає реквізити з різними
 * призначеннями: ЄСВ і військовий збір). Якби документ під таким рахунком
 * стрибав через нього одразу на шаблон отримувача, платіж пішов би з чужим
 * призначенням. Резолвер лишається двоаргументним навмисно: ланцюг
 * склеюється у викликача, тож кожен рівень має рівно одну точку резолву.
 *
 * **`inheritedPaymentPurposeTemplate` — required non-empty string.** Sprint 1
 * Zod entity (`Business.paymentPurposeTemplate.min(1)`) гарантує non-empty
 * bottom-string на будь-якому шляху, що читає `Business`-документ, а
 * account-override або non-empty, або `null` (тоді резолв рівнем нижче вже
 * повернув business-шаблон); цей resolver покладається на цей invariant.
 */
export function effectiveInvoicePurpose(
    invoicePaymentPurpose: string | null,
    inheritedPaymentPurposeTemplate: string
): string {
    return invoicePaymentPurpose ?? inheritedPaymentPurposeTemplate;
}
