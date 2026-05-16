import { z } from 'zod';

import { UserProfileSchema } from '../entities/user';
import { emailSchema, passwordSchema } from '../validation/common';
import { LandingClaimResultSchema } from './landing-claim';
import { LandingDraftSchema } from './landing-draft';

// --- Magic Link Purpose ---

export const MAGIC_LINK_PURPOSE = {
    LOGIN: 'login',
    REGISTER: 'register',
    RESET_PASSWORD: 'reset-password',
    DELETE_ACCOUNT: 'delete-account',
} as const;

export type MagicLinkPurpose =
    (typeof MAGIC_LINK_PURPOSE)[keyof typeof MAGIC_LINK_PURPOSE];

export const MagicLinkPurposeSchema = z.enum([
    MAGIC_LINK_PURPOSE.LOGIN,
    MAGIC_LINK_PURPOSE.REGISTER,
    MAGIC_LINK_PURPOSE.RESET_PASSWORD,
    MAGIC_LINK_PURPOSE.DELETE_ACCOUNT,
]);

// --- Magic Link ---

/**
 * Sprint 10 §SP-7/§SP-11/§SP-12 — magic-link endpoint приймає **три optional
 * sibling-fields** для anon-claim cross-device flow:
 *
 *  - `landingDraft` — anon-payload (receiverName / iban / taxId / purpose) для
 *    серверного claim після verify.
 *  - `claimIdempotencyKey` — UUID v4, anti-duplicate token (Sprint 10 §SP-11).
 *  - `termsVersion` — версія terms, прийнятих anon-користувачем на signin-step
 *    (Sprint 10 §SP-12 terms-pre-stamp; backend stamps `acceptedTermsVersion`
 *    ДО claim, що закриває acceptTerms ordering window).
 *
 * **Cross-field-coexistence invariant** (`landingDraft <-> claimIdempotencyKey`):
 * draft без idempotency-key не має сенсу — backend не може дедуплікувати POST1
 * без token-а; key без draft не має payload-у. Refine reject-ить mismatched-pair
 * на write-side через `LANDING_DRAFT_AND_KEY_MUST_COEXIST`. `termsVersion` —
 * окремий optional-field, БЕЗ cross-coupling: він прокидається на всіх 4
 * frontend-call-site-ах `sendMagicLink` коли user прийняв terms (включно з
 * reset-password-flow, де `landingDraft` не передається).
 */
export const SendMagicLinkSchema = z
    .object({
        email: z.string().email(),
        purpose: MagicLinkPurposeSchema.optional(),
        redirectTo: z.string().startsWith('/').max(2048).optional(),
        landingDraft: LandingDraftSchema.optional(),
        claimIdempotencyKey: z
            .string()
            .uuid({ message: 'INVALID_CLAIM_IDEMPOTENCY_KEY' })
            .optional(),
        termsVersion: z.string().optional(),
    })
    .refine(
        (data) =>
            (data.landingDraft !== undefined) ===
            (data.claimIdempotencyKey !== undefined),
        {
            message: 'LANDING_DRAFT_AND_KEY_MUST_COEXIST',
            path: ['claimIdempotencyKey'],
        }
    );

export const VerifyMagicLinkSchema = z.object({
    token: z.string().min(1),
});

// --- Auth Response ---

/**
 * Sprint 13 — `claim` як вкладений discriminated union (single source of truth
 * у `packages/types/src/contracts/landing-claim.ts`). До Sprint 13 claim-stan
 * жив у 5 плоских optional-полях з refine на response-side; тепер shape
 * гарантується самою discriminated-union-структурою.
 *
 * **Чому success-with-state, а не throw**: claim-failure НЕ блокує auth —
 * user уже автентикований, accessToken у response body, refresh-cookie
 * виставлено. Discriminated success-shape — uniform path для finalization
 * (`acceptTerms + getMe + setUser`); claim-state читається post-finalization
 * для router.replace-target-у.
 *
 * `claim` nullable+optional: `null` коли verify-magic-link виконав auth-flow
 * без anon-claim (звичайний login/register); `undefined` коли response
 * формується іншим endpoint-ом (login/password — claim там нерелевантний).
 */
export const AuthResponseSchema = z.object({
    user: UserProfileSchema,
    accessToken: z.string(),
    purpose: MagicLinkPurposeSchema.optional(),
    accountDeleted: z.boolean().optional(),
    claim: LandingClaimResultSchema.nullable().optional(),
});

// --- Check Email ---

export const CheckEmailSchema = z.object({
    email: emailSchema,
});

export const CheckEmailResponseSchema = z.object({
    hasPassword: z.boolean(),
    isNewUser: z.boolean(),
});

// --- Password Auth ---

export const LoginPasswordSchema = z.object({
    email: emailSchema,
    password: z.string(),
    termsVersion: z.string().optional(),
});

export const SetPasswordSchema = z.object({
    password: passwordSchema,
});

export const ChangePasswordSchema = z
    .object({
        currentPassword: z.string(),
        newPassword: passwordSchema,
    })
    .refine((data) => data.currentPassword !== data.newPassword, {
        path: ['newPassword'],
    });

export const VerifyPasswordSchema = z.object({
    password: z.string(),
});

export const ResetPasswordSchema = z
    .object({
        token: z.string().min(1),
        newPassword: passwordSchema,
        confirmPassword: passwordSchema,
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
        path: ['confirmPassword'],
    });

// --- Refresh ---

export const RefreshSchema = z.object({
    timezone: z.string().min(1).max(100).optional(),
});

export type RefreshDto = z.infer<typeof RefreshSchema>;

// --- Delete Account Verify Response ---

export const DeleteAccountVerifyResponseSchema = z.object({
    deleted: z.literal(true),
    purpose: z.literal(MAGIC_LINK_PURPOSE.DELETE_ACCOUNT),
    message: z.string(),
});

// --- Types ---

export type SendMagicLinkDto = z.infer<typeof SendMagicLinkSchema>;
export type VerifyMagicLinkDto = z.infer<typeof VerifyMagicLinkSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type DeleteAccountVerifyResponse = z.infer<
    typeof DeleteAccountVerifyResponseSchema
>;
export type VerifyMagicLinkResponse =
    | AuthResponse
    | DeleteAccountVerifyResponse;
export type CheckEmailDto = z.infer<typeof CheckEmailSchema>;
export type CheckEmailResponse = z.infer<typeof CheckEmailResponseSchema>;
export type LoginPasswordDto = z.infer<typeof LoginPasswordSchema>;
export type SetPasswordDto = z.infer<typeof SetPasswordSchema>;
export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;
export type VerifyPasswordDto = z.infer<typeof VerifyPasswordSchema>;
export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;
