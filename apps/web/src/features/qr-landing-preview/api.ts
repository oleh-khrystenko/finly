import {
    mapLandingDraftToCreateBusinessRequest,
    QrPreviewInputSchema,
    QrPreviewResponseSchema,
    type LandingDraft,
    type QrPreviewInput,
    type QrPreviewResponse,
} from '@finly/types';

import { apiClient, publicPostJson } from '@/shared/api/client';

/**
 * Sprint 8 §8.3 — anon QR-preview-fetch.
 *
 * **`publicPostJson`, не `apiClient`** (sprint plan §8.3 pre-flight):
 * anon-flow живе під контрактом "без auth, без cookie". axios `apiClient`
 * має `withCredentials: true` + Bearer-interceptor, що порушив би це: якщо
 * anon-користувач залогінений у іншій вкладці на cabinet host, його
 * `bid_refresh`-cookie + `Bearer`-токен можуть просочитися у anon-запит.
 * Native `fetch({ credentials: 'omit' })` гарантовано вирізає те і інше.
 *
 * **`QrPreviewInputSchema.parse(input)` belt-and-suspenders**: RHF resolver
 * вже викликав цю саму схему перед submit-ом, але повторна валідація тут —
 * захист від програмного callsite-у, що минає форму.
 */
export async function fetchQrPreview(
    input: QrPreviewInput
): Promise<QrPreviewResponse> {
    const validated = QrPreviewInputSchema.parse(input);
    const envelope = await publicPostJson<
        QrPreviewInput,
        { data: QrPreviewResponse }
    >('/qr/preview', validated);
    return QrPreviewResponseSchema.parse(envelope.data);
}

/**
 * Sprint 10 §10.2 — POST1 anon-claim chain: створити Business з landing-draft-у
 * + idempotency-key.
 *
 * **Тільки для авторизованих** (`apiClient` з Bearer-токеном). Anon потрапляє
 * сюди тільки після проходження `/auth/signin` → `useClaimLandingDraft` →
 * виклик цієї функції.
 *
 * **`mapLandingDraftToCreateBusinessRequest` — shared helper** з
 * `@finly/types/contracts/landing-draft.ts`. Single source of truth для
 * field-mapping (`receiverName → name`, `purpose → paymentPurposeTemplate`,
 * `acceptedBanks: [...MVP_BANKS]`, `type: 'individual'`, `taxId` top-level,
 * `claimIdempotencyKey` top-level). Backend `LandingClaimService` використовує
 * той самий helper — drift-vector закритий compile-time.
 *
 * **`claimIdempotencyKey` — required**: backend `BusinessesService.create`
 * дедуплікує через partial-unique-index `(ownerId, claimIdempotencyKey)`. На
 * retry-after-tab-close той самий key → backend повертає existing Business
 * replay-shape без створення дублікату.
 */
export async function createBusinessFromDraft(
    draft: LandingDraft,
    claimIdempotencyKey: string
): Promise<{ slug: string }> {
    const body = mapLandingDraftToCreateBusinessRequest(
        draft,
        claimIdempotencyKey
    );
    const { data } = await apiClient.post<{ data: { slug: string } }>(
        '/businesses/me',
        body
    );
    return data.data;
}

/**
 * Sprint 10 §10.2 — POST2 anon-claim chain: створити Account під щойно
 * створеним Business з IBAN з landing-draft-у.
 *
 * **Backend auto-default name** з МФО+last4 — landing-форма не має input для
 * account-name; opt-out: не передаємо `name`. `bankCode` backend резолвить з
 * `bankCodeFromIban(iban)` і пише як stored value (Sprint 9 §SP-9).
 *
 * **Idempotency-семантика на цей рівень не потрібна** — `(businessId, iban)`
 * compound-unique (Sprint 9 §SP-2) уже дає anti-duplicate effect.
 */
export async function createAccountFromDraft(
    businessSlug: string,
    draft: LandingDraft
): Promise<{ slug: string }> {
    const { data } = await apiClient.post<{ data: { slug: string } }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/accounts`,
        { iban: draft.iban }
    );
    return data.data;
}
