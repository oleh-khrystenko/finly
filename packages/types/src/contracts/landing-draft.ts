import { z } from 'zod';

import { MVP_BANKS } from '../constants/banks';
import { QrPreviewInputSchema } from './qr-preview';
import type { CreateBusinessRequest } from './businesses';

/**
 * Sprint 10 §10.0 — anon-claim payload shape.
 *
 * Спільний контракт для трьох транспорт-точок:
 *  1. `qrLandingDraftStore.formData` у frontend persisted-store (localStorage).
 *  2. `SendMagicLinkDto.landingDraft` sibling-поле у `POST /auth/magic-link/send`.
 *  3. `AuthResponseDto.failedClaimDraft` у response на verify, коли backend
 *     виконав 2-step claim і POST впав (зашит у failure-recovery flow).
 *
 * Поля — точно ті самі, що у `QrPreviewInputSchema` (`receiverName`, `iban`,
 * `taxId`, `purpose`); `.pick()` гарантує, що field-validators (NBU charset,
 * char/byte-limits, IBAN-checksum, РНОКПП-checksum) залишаються single source
 * of truth і не drift-яться між anon-preview і anon-claim. Якщо у Sprint 9+
 * щось зміниться у `QrPreviewInputSchema` — `LandingDraft` поїде синхронно
 * без явної міграції localStorage-snapshot-у.
 *
 * **Чому НЕ 5-те поле `claimIdempotencyKey` тут:** Семантично draft = "що
 * ввели на лендінгу" — 4 user-input-поля. Idempotency-key — технічний
 * deduplication-token, що генерується frontend-side на CTA-click. Тримання їх
 * окремо тримає `LandingDraft`-shape user-facing і малим, а `claimIdempotency-
 * Key` прокидається на API як sibling-параметр (`SendMagicLinkSchema`,
 * `attemptLandingClaim`, mapping-helper).
 */
export const LandingDraftSchema = QrPreviewInputSchema.pick({
    receiverName: true,
    iban: true,
    taxId: true,
    purpose: true,
});

export type LandingDraft = z.infer<typeof LandingDraftSchema>;

/**
 * Pure-function helper, що мапить anon-landing-draft + idempotency-key у
 * `CreateBusinessRequest`-shape для `individual`-variant-у. Single source of
 * truth для семантичного field-mapping-у, використовується на двох callsite-ах:
 *
 *  1. **Frontend**: `features/qr-landing-preview/api.ts` →
 *     `createBusinessFromDraft(draft, claimIdempotencyKey)` будує body
 *     `POST /businesses/me` через цей helper.
 *  2. **Backend**: `LandingClaimService.attemptLandingClaim` будує DTO для
 *     `BusinessesService.create(userId, mapLandingDraftToCreateBusinessRequest(
 *     draft, claimIdempotencyKey), isBookkeeperMode)`.
 *
 * Без spільного helper-а Sprint 10 одночасно вводить дві незалежні реалізації
 * mapping-у — frontend і backend, — і drift-vector активується першим
 * розширенням `LandingDraft`. TS compile-time guard через явний return-type
 * `CreateBusinessRequest`: додавання нового required-поля у
 * `CreateBusinessSchema.individual` variant без оновлення цього helper-а дає
 * type-error.
 *
 * **Семантика mapping-у** (decoded від `LandingDraft → CreateBusinessRequest`):
 *  - `receiverName → name` — переіменування поля під cabinet-конвенцію.
 *  - `purpose → paymentPurposeTemplate` — те саме переіменування.
 *  - `taxId` — top-level (Sprint 9 §SP-1 flatten з `requisites`).
 *  - `iban` — **не маситься** у Business; переходить на Account через окремий
 *    POST (Sprint 9 §SP-1 split).
 *  - `type` — фіксовано `'individual'` (anon-форма зачинена per QrPreviewInput-
 *    Schema rationale).
 *  - `acceptedBanks` — повний набір `MVP_BANKS` (anon-користувач не вибирає
 *    банки явно; default-set = всі підтримувані MVP).
 *  - `claimIdempotencyKey` — top-level, обов'язково присутній у write-DTO для
 *    backend dedup через partial-unique `(ownerId, claimIdempotencyKey)`.
 */
export function mapLandingDraftToCreateBusinessRequest(
    draft: LandingDraft,
    claimIdempotencyKey: string
): CreateBusinessRequest {
    return {
        type: 'individual',
        name: draft.receiverName,
        taxId: draft.taxId,
        paymentPurposeTemplate: draft.purpose,
        acceptedBanks: [...MVP_BANKS],
        claimIdempotencyKey,
    };
}
