import type { InvoicePayeeSnapshot } from '@finly/types';

/**
 * Sprint 4 — frontend mirror backend-резолвера
 * `apps/api/src/modules/invoices/purpose-resolver.ts::effectiveInvoicePurpose`
 * (Sprint 1 inheritance contract: `paymentPurpose ?? template`).
 *
 * **Чому mirror, а не shared у `@finly/types`.** Backend-резолвер живе у NestJS-
 * модулі поряд з payload-mapper-ом і slug-generator-ом, які інтегрально
 * NestJS-залежні. Винесення pure-резолвера у пакет `@finly/types` додало б
 * cross-package coupling заради двох рядків. Mirror-helper тут — той самий
 * pattern, що Sprint 4 §4.7 рішення для `formatKopecksAsHryvnia` (UI-формат не
 * має backend-аналога) та `getInvoiceStatus` (lifecycle-резолвер). Контракти
 * mirror-яться через однакову формулу `value ?? template`.
 *
 * **Контракт.** `invoicePaymentPurpose` — те, що зберіг ФОП у документі (НЕ
 * post-resolve). `null` ⇒ inheritance signal на успадкований шаблон. Resolver НЕ
 * перевіряє на whitespace/empty — Sprint 1 Zod-entity (`Business.payment
 * PurposeTemplate.min(1)`) гарантує non-empty bottom-string на write-side.
 *
 * **Sprint 29 — ланцюг трирівневий: `invoice → account → business`.** Другий
 * аргумент — вже resolved шаблон рівнем нижче (`resolveAccountPurposeTemplate`),
 * а не сирий `business.paymentPurposeTemplate`; рахунок має власний
 * `paymentPurposeTemplate`, і якби документ під ним стрибав одразу на шаблон
 * отримувача, UI підказував би не те призначення, що піде в банк. Дзеркалить
 * backend `purpose-resolver.ts` дослівно, включно з дволанковою сигнатурою.
 *
 * **Чому окремий від `resolveInvoicePayeePurpose`.** Sprint 1 contract — pure
 * inheritance-rule (legacy fallback path, edit-form prediction "що буде, якщо
 * save-нути null"). Sprint 4 snapshot-aware-resolver — це consumer-side reader
 * для "що піде у NBU payload". Розділення так само присутнє на backend:
 * `purpose-resolver.ts` — pure Sprint 1; snapshot-resolution inline у
 * `payload-mapper.ts` і `public-invoices.controller.ts`.
 */
export function effectiveInvoicePurpose(
    invoicePaymentPurpose: string | null,
    inheritedPaymentPurposeTemplate: string
): string {
    return invoicePaymentPurpose ?? inheritedPaymentPurposeTemplate;
}

/**
 * Sprint 29 — frontend mirror backend-резолвера
 * `apps/api/src/modules/accounts/payload-mapper.ts::resolveAccountPurposeTemplate`.
 *
 * Рахунок легітимно тримає власне призначення (один отримувач, окремі реквізити
 * під ЄСВ і під військовий збір — саме призначення розносить платіж), тому
 * шаблон не може бути спільним на весь отримувач. `null` на рахунку ⇒
 * успадкування з отримувача.
 *
 * **Єдина точка резолву account-рівня на вебі.** Кожен UI-споживач, що показує
 * «за замовчуванням буде ось це», зобовʼязаний пройти через неї: інакше кабінет
 * підказує шаблон отримувача, а в `payeeSnapshot` і QR іде шаблон рахунку.
 */
export function resolveAccountPurposeTemplate(
    accountPaymentPurposeTemplate: string | null,
    businessPaymentPurposeTemplate: string
): string {
    return accountPaymentPurposeTemplate ?? businessPaymentPurposeTemplate;
}

/**
 * Sprint 4 review fix — frontend mirror **повної** backend-chain-логіки з
 * `payload-mapper.ts:49-65` і `public-invoices.controller.ts:137-142`:
 *
 *     snapshot?.paymentPurpose
 *       ?? effectiveInvoicePurpose(invoicePaymentPurpose, businessTemplate)
 *
 * **Інваріант** — UI має показувати РІВНО ТЕ, що піде у NBU payload (single
 * source of truth з backend). Якщо ФОП виставив інвойс з `paymentPurpose: null`,
 * потім відредагував `business.paymentPurposeTemplate`, frozen `payeeSnapshot`
 * у БД пам'ятає original-рядок — і саме він піде у банк-додаток. Cabinet card
 * має показати той самий текст, не runtime-resolved-with-current-template
 * (інакше кабінетний ФОП бачить одне, банк-додаток клієнта — інше).
 *
 * **Legacy fallback** — `payeeSnapshot === null` для invoices, створених до
 * Sprint 4 review fix і не мігрованих. У такому стані backend читає live
 * `business.paymentPurposeTemplate`; mirror тут робить те саме через
 * `effectiveInvoicePurpose`. Migration `2026-05-08-invoices-payee-snapshot.ts`
 * backfill-ить snapshot — fallback eventually unreachable post-deploy.
 */
export function resolveInvoicePayeePurpose(
    snapshot: InvoicePayeeSnapshot | null,
    invoicePaymentPurpose: string | null,
    inheritedPaymentPurposeTemplate: string
): string {
    return (
        snapshot?.paymentPurpose ??
        effectiveInvoicePurpose(
            invoicePaymentPurpose,
            inheritedPaymentPurposeTemplate
        )
    );
}

/**
 * UI-помічник: чи показуваний рядок прийшов через runtime-fallback на
 * live-template (legacy без snapshot, поле `null`). Тільки у цьому стані
 * текст драйфтить при редагуванні business — і UI зобов'язаний підказати
 * італіком/tooltip-ом, що це наслідуване значення. Frozen snapshot, навіть
 * коли `invoice.paymentPurpose === null`, — це **explicit frozen template
 * at create**, не runtime-inheritance, тож італік/tooltip не потрібні.
 */
export function isInvoicePurposeRuntimeInherited(
    snapshot: InvoicePayeeSnapshot | null,
    invoicePaymentPurpose: string | null
): boolean {
    return snapshot === null && invoicePaymentPurpose === null;
}
