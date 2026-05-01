import { z } from 'zod';

import { CURRENT_TERMS_VERSION } from '../constants/terms';
import { firstNameSchema, lastNameSchema } from '../validation/common';

/**
 * `lastName` приходить як non-empty string, якщо передається. Empty literal
 * (`''`) свідомо не дозволений — після Sprint 1 прізвище є required-полем
 * онбордингу і не повинно очищатись через API. Спосіб "видалити прізвище" не
 * існує: воно required для платіжного UX (відображається на публічній сторінці
 * як "ФОП Прізвище"). Сценарій зміни — звичайний replace через PATCH.
 */
export const UpdateProfileSchema = z.object({
    firstName: firstNameSchema.optional(),
    lastName: lastNameSchema.optional(),
    avatar: z.string().url().optional(),
});

export const AcceptTermsSchema = z.object({
    termsVersion: z.literal(CURRENT_TERMS_VERSION),
});

export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;
export type AcceptTermsDto = z.infer<typeof AcceptTermsSchema>;
