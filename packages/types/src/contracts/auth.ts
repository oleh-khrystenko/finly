import { z } from 'zod';

import { UserProfileSchema } from '../entities/user';
import { emailSchema, passwordSchema } from '../validation/common';

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

export const SendMagicLinkSchema = z.object({
    email: z.string().email(),
    purpose: MagicLinkPurposeSchema.optional(),
    redirectTo: z.string().startsWith('/').max(2048).optional(),
});

export const VerifyMagicLinkSchema = z.object({
    token: z.string().min(1),
});

// --- Auth Response ---

export const AuthResponseSchema = z.object({
    user: UserProfileSchema,
    accessToken: z.string(),
    purpose: MagicLinkPurposeSchema.optional(),
    accountDeleted: z.boolean().optional(),
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
export type VerifyMagicLinkResponse = AuthResponse | DeleteAccountVerifyResponse;
export type CheckEmailDto = z.infer<typeof CheckEmailSchema>;
export type CheckEmailResponse = z.infer<typeof CheckEmailResponseSchema>;
export type LoginPasswordDto = z.infer<typeof LoginPasswordSchema>;
export type SetPasswordDto = z.infer<typeof SetPasswordSchema>;
export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;
export type VerifyPasswordDto = z.infer<typeof VerifyPasswordSchema>;
export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;
