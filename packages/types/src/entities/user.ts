import { z } from 'zod';

import { UserBillingSchema } from '../contracts/payments';
import { DEFAULT_USER_ROLE, USER_ROLES } from '../enums/user-role';
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

export const UserExecutionsSchema = z.object({
    balance: z.number().int().min(0),
    freeReportUsed: z.boolean(),
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
    executions: UserExecutionsSchema,
    hasPassword: z.boolean(),
    deletedAt: z.coerce.date().nullable().optional(),
    accountDeletionRequestedAt: z.coerce.date().nullable().optional(),
    createdAt: z.coerce.date(),
    lastLoginAt: z.coerce.date().optional(),
    billing: UserBillingSchema.nullable().optional(),
    termsAcceptedAt: z.coerce.date().nullable().optional(),
    termsVersion: z.string().nullable().optional(),
});

export const UserProfileSchema = UserSchema.pick({
    id: true,
    email: true,
    role: true,
    worksAsBookkeeper: true,
    profile: true,
    executions: true,
    hasPassword: true,
    deletedAt: true,
    accountDeletionRequestedAt: true,
    billing: true,
    termsVersion: true,
});

export type User = z.infer<typeof UserSchema>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
