import {
    MVP_BANKS,
    QrPreviewInputSchema,
    QrPreviewResponseSchema,
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
 * захист від програмного callsite-у, що минає форму (наприклад, retry-лоgika
 * чи schema-drift через persisted localStorage). Кидає `ZodError` з тим
 * самим SCREAMING_SNAKE-кодом, який RHF мапить через `getZodFieldError`.
 *
 * **`QrPreviewResponseSchema.parse(envelope.data)` defense-in-depth**:
 * страхує від silent backend-shape-drift. Якщо `link` чи `qrPngBase64`
 * випаде з response — ZodError на boundary, не silent crash у UiQrImage.
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
 * Sprint 8 §8.3 — claim-flow API: створити Business з landing-draft-у.
 *
 * **Тільки для авторизованих** — використовує `apiClient` (Bearer-токен
 * необхідний для `JwtActiveGuard` на `POST /businesses/me`). Anon-користувач
 * сюди не дійде: `setIntent('claim-pending')` + redirect на `/auth/signin`,
 * потім `useClaimLandingDraft` (§8.4) спрацює після успішного auth.
 *
 * **Payload точно матчить `createIndividualVariant.strict()`** з
 * `packages/types/src/contracts/businesses.ts:88-99`: рівно 5 ключів
 * (`type`, `name`, `requisites`, `paymentPurposeTemplate`, `acceptedBanks`),
 * жодних додаткових. Опціональні `taxationSystem` / `isVatPayer` /
 * `seoIndexEnabled` / `invoiceSlugPresetDefault` навмисно випадають —
 * `.strict()` reject-ить їх для individual-варіанту, а Mongoose-defaults
 * проставлять при insert-і.
 *
 * **`acceptedBanks: [...MVP_BANKS]` — повний список 11 банків**: той самий
 * default, що cabinet-wizard на step 4 (Sprint 3 рішення B6). Bare `[]`
 * рідко-плив contract-rule `acceptedBanksField.min(1)`. Banner на business-
 * detail після claim-у (§8.5) запрошує переглянути список.
 *
 * Spread `[...MVP_BANKS]` — копія з `readonly` tuple у mutable array, що
 * приймає zod schema (`z.array(...)`).
 */
export async function claimLandingDraftAsBusiness(
    formData: QrPreviewInput
): Promise<{ slug: string }> {
    const { data } = await apiClient.post<{ data: { slug: string } }>(
        '/businesses/me',
        {
            type: 'individual',
            name: formData.receiverName,
            requisites: { iban: formData.iban, taxId: formData.taxId },
            paymentPurposeTemplate: formData.purpose,
            acceptedBanks: [...MVP_BANKS],
        }
    );
    return data.data;
}
