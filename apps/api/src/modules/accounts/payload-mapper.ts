import type { PayloadInput } from '@finly/types';

import type { BusinessDocument } from '../businesses/schemas/business.schema';
import type { AccountDocument } from './schemas/account.schema';

/**
 * Sprint 9 §9.1 — маппінг `(Business, Account)` → NBU `PayloadInput`
 * для `QrService.renderForNbuPayload` / `buildNbuPayloadLinkForInput` на
 * per-account public-вивісці (`pay.finly.com.ua/{businessSlug}/{accountSlug}`).
 *
 * **Семантика "вивіска без суми"** (Sprint 3 §A3 + Sprint 9 §SP-4): public
 * сторінка — платіжна вивіска account-у; клієнт сам вписує суму у банк-додатку
 * після того, як скан/тап відкриє оплату з реквізитами. Тому `amountKopecks`
 * у payload — `null`.
 *
 * **Source-mapping:**
 *  - `receiverName` ← `business.name` (юр-name платника на payload, не
 *    `account.name` — той вторинний UI-label).
 *  - `iban` ← `account.iban` (Sprint 9 переніс IBAN з business на account).
 *  - `receiverTaxId` ← `business.taxId` (top-level після Sprint 9 §SP-1).
 *  - `purpose` ← `business.paymentPurposeTemplate`.
 */
export function buildPayloadInputFromAccount(
    business: BusinessDocument,
    account: AccountDocument
): PayloadInput {
    return {
        receiverName: business.name,
        iban: account.iban,
        receiverTaxId: business.taxId,
        amountKopecks: null,
        purpose: business.paymentPurposeTemplate,
    };
}
