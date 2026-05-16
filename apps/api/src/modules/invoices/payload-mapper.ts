import { formatYymmddhhmmss, type PayloadInput } from '@finly/types';

import type { AccountDocument } from '../accounts/schemas/account.schema';
import type { BusinessDocument } from '../businesses/schemas/business.schema';
import { effectiveInvoicePurpose } from './purpose-resolver';
import type { InvoiceDocument } from './schemas/invoice.schema';

/**
 * Sprint 4 §4.3 + Sprint 9 §9.1 — маппінг `(Business, Account, Invoice)` →
 * NBU `PayloadInput`.
 *
 * **Receiver-fields пріоритетно з `invoice.payeeSnapshot`** (Sprint 4 review
 * fix snapshot). Sprint 9 рефакторинг: legacy-fallback на live
 * `account.iban` (раніше `business.requisites.iban`) і `business.taxId`
 * (раніше `business.requisites.taxId`).
 *
 * **`amountKopecks` = `invoice.amount`.** `null` валідно — режим qr-decisions
 * §1.4 "вивіска у межах інвойсу".
 *
 * **`fieldLockMask` derived з `invoice.amountLocked`.** Норматив 003 §II.4.14:
 *  - `FFFF` — всі поля locked, включно з сумою.
 *  - `FEFF` — все locked крім поля 8 (Сума).
 *
 * **`validUntil` через `formatYymmddhhmmss`** (Sprint 4 §4.1) — Kyiv-tz.
 */
export function buildPayloadInputFromInvoice(
    business: BusinessDocument,
    account: AccountDocument,
    invoice: InvoiceDocument
): PayloadInput {
    const snapshot = invoice.payeeSnapshot;
    return {
        receiverName: snapshot?.recipientName ?? business.name,
        iban: snapshot?.iban ?? account.iban,
        receiverTaxId: snapshot?.taxId ?? business.taxId,
        amountKopecks: invoice.amount,
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
