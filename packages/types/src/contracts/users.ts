import { z } from 'zod';

import { CURRENT_TERMS_VERSION } from '../constants/terms';
import { firstNameSchema, lastNameSchema } from '../validation/common';

export const UpdateProfileSchema = z.object({
    firstName: firstNameSchema.optional(),
    lastName: lastNameSchema.or(z.literal('')).optional(),
    avatar: z.string().url().optional(),
});

export const AcceptTermsSchema = z.object({
    termsVersion: z.literal(CURRENT_TERMS_VERSION),
});

export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;
export type AcceptTermsDto = z.infer<typeof AcceptTermsSchema>;
