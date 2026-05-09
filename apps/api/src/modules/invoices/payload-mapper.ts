import { formatYymmddhhmmss, type PayloadInput } from '@finly/types';

import type { BusinessDocument } from '../businesses/schemas/business.schema';
import { effectiveInvoicePurpose } from './purpose-resolver';
import type { InvoiceDocument } from './schemas/invoice.schema';

/**
 * Sprint 4 §4.3 — маппінг (Invoice + fallback Business) → NBU `PayloadInput`
 * для `QrService.renderForNbuPayload` / `buildNbuPayloadLinkForInput`.
 *
 * **Receiver-fields пріоритетно з `invoice.payeeSnapshot`** (Sprint 4 review
 * fix). Snapshot фрозить платіжні реквізити на момент create — public payload
 * для вже виданого рахунку не змінюється, навіть коли ФОП редагує IBAN/
 * ім'я/дефолтне призначення у настройках бізнесу. Раніше mapper читав
 * `business.name`/`business.requisites.iban`/`business.requisites.taxId` live
 * з-під `BusinessDocument`-у — будь-яка зміна business-полів тихо ламала
 * payload вже-розданих посилань (і особливо погано для `with-purpose`-slug-у,
 * де URL frozen на момент create, а runtime-resolve використовував поточний
 * `business.paymentPurposeTemplate`).
 *
 * **Fallback на live `business` для legacy-invoices** (`payeeSnapshot === null`).
 * Existing документи, створені до Sprint 4 review fix, читають реквізити
 * з-під поточного business-у — той самий buggy patern, що був раніше, але
 * тепер обмежений лише legacy. Migration `2026-05-08-invoices-payee-snapshot.ts`
 * backfill-ить snapshot для legacy → fallback eventually unreachable, можна
 * dropнути у Sprint 6 cleanup.
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
    const snapshot = invoice.payeeSnapshot;
    return {
        receiverName: snapshot?.recipientName ?? business.name,
        iban: snapshot?.iban ?? business.requisites.iban,
        receiverTaxId: snapshot?.taxId ?? business.requisites.taxId,
        amountKopecks: invoice.amount,
        // Snapshot.paymentPurpose уже resolved-string (effectiveInvoicePurpose
        // викликаний на момент create); legacy-fallback викликає resolver на
        // runtime з поточним template — той самий buggy old behavior, але
        // обмежено pre-Sprint-4-review-fix invoices.
        purpose:
            snapshot?.paymentPurpose ??
            effectiveInvoicePurpose(
                invoice.paymentPurpose,
                business.paymentPurposeTemplate
            ),
        fieldLockMask: invoice.amountLocked ? 'FFFF' : 'FEFF',
        validUntil: invoice.validUntil
            ? formatYymmddhhmmss(invoice.validUntil)
            : null,
    };
}
