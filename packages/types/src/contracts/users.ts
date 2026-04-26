import { z } from 'zod';

import { LANG } from '../constants/lang';
import { CURRENT_TERMS_VERSION } from '../constants/terms';
import { firstNameSchema, lastNameSchema } from '../validation/common';

const langValues = Object.values(LANG) as [string, ...string[]];

export const UpdateLangSchema = z.object({
    lang: z.enum(langValues),
});

export const UpdateProfileSchema = z.object({
    firstName: firstNameSchema.optional(),
    lastName: lastNameSchema.or(z.literal('')).optional(),
    avatar: z.string().url().optional(),
    preferredLang: z.enum(langValues).optional(),
});

export const AcceptTermsSchema = z.object({
    termsVersion: z.literal(CURRENT_TERMS_VERSION),
});

export type UpdateLangDto = z.infer<typeof UpdateLangSchema>;
export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;
export type AcceptTermsDto = z.infer<typeof AcceptTermsSchema>;
