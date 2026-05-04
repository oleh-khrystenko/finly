import { formatYymmddhhmmss, type PayloadInput } from '@finly/types';

import type { BusinessDocument } from '../businesses/schemas/business.schema';
import { effectiveInvoicePurpose } from './purpose-resolver';
import type { InvoiceDocument } from './schemas/invoice.schema';

/**
 * Sprint 4 §4.3 — маппінг (Business, Invoice) → NBU `PayloadInput` для
 * `QrService.renderForNbuPayload` / `buildNbuPayloadLinkForInput`.
 *
 * **Аналог `buildPayloadInputFromBusiness` Sprint 3, але для invoice-flow.**
 * Receiver-fields лишаються з business; нові поля (`amountKopecks`,
 * `fieldLockMask`, `validUntil`) — з invoice.
 *
 * **`amountKopecks` = `invoice.amount`.** `null` валідно — режим qr-decisions
 * §1.4 "вивіска у межах інвойсу": клієнт сам вписує суму у банк-додатку.
 *
 * **`fieldLockMask` derived з `invoice.amountLocked`.** Норматив 003 §II.4.14:
 *  - `FFFF` — всі поля locked, включно з сумою. Клієнт не може редагувати.
 *  - `FEFF` — все locked крім поля 8 (Сума) — клієнт може правити суму.
 *  Інші біти 1–5, 11, 14–17 завжди locked (`PayloadInputSchema` enforce-ить
 *  required-bits через `FIELD_LOCK_MASK_REQUIRED_BITS`).
 *
 * **`purpose` через `effectiveInvoicePurpose` — single source of truth.** Той
 * самий resolver, що `InvoiceSlugGeneratorService` (`with-purpose`-пресет).
 * Якщо два call-sites дрейфнуть на inheritance-rule (`null ⇒
 * business.paymentPurposeTemplate`), slug у URL покаже одне, а банк-додаток
 * отримає інше — ламає UX. Тримаємо single helper.
 *
 * **`validUntil` через `formatYymmddhhmmss` (Sprint 4 §4.1).** Конвертація у
 * локальний український час (Kyiv-tz), не UTC. План SP-7: ФОП обирає
 * "до конкретної дати" 23:59:59 локально — payload банку має це зберегти
 * без зсуву на 2-3 години (UTC). `null` validUntil → null payload-field
 * (норматив дозволяє empty).
 *
 * Pure-функція щодо вхідних документів — тестується ізольовано без DI/mocks.
 */
export function buildPayloadInputFromInvoice(
    business: BusinessDocument,
    invoice: InvoiceDocument
): PayloadInput {
    return {
        receiverName: business.name,
        iban: business.requisites.iban,
        receiverTaxId: business.requisites.taxId,
        amountKopecks: invoice.amount,
        purpose: effectiveInvoicePurpose(
            invoice.paymentPurpose,
            business.paymentPurposeTemplate
        ),
        fieldLockMask: invoice.amountLocked ? 'FFFF' : 'FEFF',
        validUntil: invoice.validUntil
            ? formatYymmddhhmmss(invoice.validUntil)
            : null,
    };
}
