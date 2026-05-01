import { z } from 'zod';

import { UserBillingSchema } from '../contracts/payments';

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
    id: z.string(),
    email: z.string().email(),
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
