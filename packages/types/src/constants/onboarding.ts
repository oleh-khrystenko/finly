import type { ZodTypeAny } from 'zod';

import type { UserProfile } from '../entities/user';
import { firstNameSchema, lastNameSchema } from '../validation/common';

/**
 * Single source of truth for required onboarding fields.
 *
 * The same Zod schemas drive write-path (PATCH /users/me, ProfileForm) and
 * read-path (OnboardingInterceptor). Without this, "what counts as filled" can
 * drift between layers — e.g. profile with `lastName: ' '` could pass an
 * `=== ''` check but fail the form's `trim().min(1)` rule.
 *
 * To add a new required field:
 * 1. Add field to UserProfileDataSchema (entities/user.ts).
 * 2. Add field to `ONBOARDING_FIELD_SCHEMAS` below.
 * 3. Add field name to `ONBOARDING_REQUIRED_FIELDS`.
 * 4. Add input to ProfileForm on frontend.
 */
export const ONBOARDING_REQUIRED_FIELDS = ['firstName', 'lastName'] as const;

export type OnboardingField = (typeof ONBOARDING_REQUIRED_FIELDS)[number];

const ONBOARDING_FIELD_SCHEMAS: Record<OnboardingField, ZodTypeAny> = {
    firstName: firstNameSchema,
    lastName: lastNameSchema,
};

export function getIncompleteOnboardingFields(
    profile: UserProfile['profile'],
): OnboardingField[] {
    return ONBOARDING_REQUIRED_FIELDS.filter(
        (field) =>
            !ONBOARDING_FIELD_SCHEMAS[field].safeParse(profile[field]).success,
    );
}

export function isOnboardingComplete(
    profile: UserProfile['profile'],
): boolean {
    return getIncompleteOnboardingFields(profile).length === 0;
}
