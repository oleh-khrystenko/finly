import { z } from 'zod';

import { SlugReservationViewSchema } from '../contracts/slug-reservation';
import { DEFAULT_USER_ROLE, USER_ROLES } from '../enums/user-role';
import { validateSameOriginPath } from '../utils/path';
import { objectIdSchema } from '../validation/common';

export const UserProviderSchema = z.object({
    name: z.string(),
    id: z.string(),
});

export const UserProfileDataSchema = z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    avatar: z.string().url().optional(),
});

export const UserProfileCompletionRemindersSchema = z.object({
    firstReminderSentAt: z.coerce.date().nullable(),
    finalWarningSentAt: z.coerce.date().nullable(),
});

export const UserSchema = z.object({
    id: objectIdSchema,
    email: z.string().email(),
    /**
     * `role` — system-level capability ('user' | 'admin'). "Гість" свідомо не
     * у БД (це стан "немає JWT"). Default-and-parse безпечний для legacy
     * documents, що ще не мають поля у БД (Mongoose `default` працює тільки
     * на insert).
     */
    role: z.enum(USER_ROLES).default(DEFAULT_USER_ROLE),
    /**
     * `worksAsBookkeeper` — capability на акаунті, не окрема роль. Toggle-
     * логіка (вплив на форму створення Business) — Sprint 3. Default-parse
     * для legacy documents аналогічно `role`.
     */
    worksAsBookkeeper: z.boolean().default(false),
    provider: UserProviderSchema.optional(),
    profile: UserProfileDataSchema,
    hasPassword: z.boolean(),
    deletedAt: z.coerce.date().nullable().optional(),
    accountDeletionRequestedAt: z.coerce.date().nullable().optional(),
    createdAt: z.coerce.date(),
    lastLoginAt: z.coerce.date().optional(),
    // Sprint 27 — білінг НЕ в профілі користувача: він живе окремою сутністю
    // `BillingProfile` і віддається окремим `GET /payments/profile`
    // (`BillingProfileViewSchema`), а не в `getMe`.
    termsAcceptedAt: z.coerce.date().nullable().optional(),
    termsVersion: z.string().nullable().optional(),
    pendingPostLoginTarget: z
        .string()
        .refine(validateSameOriginPath, { message: 'INVALID_REDIRECT_TARGET' })
        .optional(),
    profileCompletionReminders: UserProfileCompletionRemindersSchema.default({
        firstReminderSentAt: null,
        finalWarningSentAt: null,
    }),
    /**
     * Sprint 20 — активна бронь бажаного slug (top-level, не в `billing`:
     * free-юзери тримають броні, а їхній `billing` — null). Web малює з цього
     * зворотний відлік і добиває намір після оплати.
     */
    activeSlugReservation: SlugReservationViewSchema.nullable().optional(),
});

export const UserProfileSchema = UserSchema.pick({
    id: true,
    email: true,
    role: true,
    worksAsBookkeeper: true,
    profile: true,
    hasPassword: true,
    deletedAt: true,
    accountDeletionRequestedAt: true,
    termsVersion: true,
    pendingPostLoginTarget: true,
    activeSlugReservation: true,
});

export type User = z.infer<typeof UserSchema>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
