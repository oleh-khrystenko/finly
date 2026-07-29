import { z } from 'zod';

import { CURRENT_TERMS_VERSION } from '../constants/terms';
import {
    firstNameSchema,
    lastNameSchema,
    middleNameSchema,
} from '../validation/common';
import { individualTaxIdZod } from '../validation/tax-id';

/**
 * `lastName` приходить як non-empty string, якщо передається. Empty literal
 * (`''`) свідомо не дозволений — після Sprint 1 прізвище є required-полем
 * онбордингу і не повинно очищатись через API. Спосіб "видалити прізвище" не
 * існує: воно required для платіжного UX (відображається на публічній сторінці
 * як "ФОП Прізвище"). Сценарій зміни — звичайний replace через PATCH.
 *
 * **`worksAsBookkeeper`** (Sprint 3 рішення E5) — toggle "Режим бухгалтера" у
 * header dropdown. Sprint 3 розкриває toggle усім без Paid-перевірки; Sprint 6
 * додає gating через окрему модалку на frontend (DTO не розширюється).
 */
export const UpdateProfileSchema = z.object({
    firstName: firstNameSchema.optional(),
    lastName: lastNameSchema.optional(),
    avatar: z.string().url().optional(),
    worksAsBookkeeper: z.boolean().optional(),
    /**
     * Тільки `null` приймається через PATCH — це explicit clear-action
     * для backend-stamped redirect-target (Sprint 11). Frontend не має
     * причини set-ити non-null value: stamp робить виключно
     * `LandingClaimService` напряму через `UsersService`-метод. Будь-яке
     * non-null value через DTO відсікається тут як anti-injection-rule.
     */
    pendingPostLoginTarget: z.literal(null).optional(),
    /**
     * Sprint 30 — власні дані для податкових платежів. На відміну від прізвища,
     * обидва поля очищувані: людина заповнила їх під разовий платіж і має право
     * прибрати РНОКПП з нашої бази. Порожній рядок — саме ця дія (сервіс робить
     * `$unset`), а не збереження порожнього значення.
     */
    middleName: z.union([middleNameSchema, z.literal('')]).optional(),
    taxId: z.union([individualTaxIdZod, z.literal('')]).optional(),
});

export const AcceptTermsSchema = z.object({
    termsVersion: z.literal(CURRENT_TERMS_VERSION),
});

export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;
export type AcceptTermsDto = z.infer<typeof AcceptTermsSchema>;
