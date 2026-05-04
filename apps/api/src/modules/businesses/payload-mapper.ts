import type { PayloadInput } from '@finly/types';

import type { BusinessDocument } from './schemas/business.schema';

/**
 * Sprint 3 §3.10 — маппінг `Business` → NBU `PayloadInput` для
 * `QrService.renderForNbuPayload`.
 *
 * **Семантика "вивіска без суми".** Sprint 3 рішення A3: публічна сторінка —
 * платіжна вивіска бізнесу, не інвойс. Клієнт сам вписує суму у банк-додатку
 * після того, як скан/тап відкриє оплату з реквізитами. Тому `amountKopecks`
 * у payload — `null` (NBU дозволяє null — клієнт-додаток покаже поле "Сума" як
 * editable). Інвойси з фіксованою сумою з'являться у Sprint 4 (окремий
 * mapper для `Invoice`, не цей).
 *
 * **`receiverName` беремо з `business.name`** — це display-форма, що ФОП
 * зафіксував у кабінеті ("ФОП Іваненко"). NBU charset whitelist + UTF-8
 * byte-limits валідуються у `build002Payload`/`build003Payload` через
 * `PayloadInputSchema`, не тут — single source of truth у builder-ах.
 *
 * **`purpose` — це `paymentPurposeTemplate`** з Business. Sprint 4 при
 * створенні invoice override-ить per-invoice `paymentPurpose`; mapper для
 * Invoice прийматиме `business + invoice` і буде окремим helper-ом.
 *
 * Чому окремий module-private file (а не inline в service): функція pure,
 * легко testable ізольовано (не потребує DI / mock-моделей), reuse-абельна
 * у Sprint 4 invoice-flow без зміни business service.
 */
export function buildPayloadInputFromBusiness(
    business: BusinessDocument
): PayloadInput {
    return {
        receiverName: business.name,
        iban: business.requisites.iban,
        receiverTaxId: business.requisites.taxId,
        amountKopecks: null,
        purpose: business.paymentPurposeTemplate,
    };
}
