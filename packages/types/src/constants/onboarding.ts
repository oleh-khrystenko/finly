import type { UserProfile } from '../entities/user';

/**
 * Single source of truth for required onboarding fields.
 * To add a new required field:
 * 1. Add field to UserProfileDataSchema (entities/user.ts)
 * 2. Add field name to this array
 * 3. Add input to ProfileForm on frontend
 */
export const ONBOARDING_REQUIRED_FIELDS = ['firstName'] as const;

export type OnboardingField = (typeof ONBOARDING_REQUIRED_FIELDS)[number];

export function getIncompleteOnboardingFields(
    profile: UserProfile['profile'],
): OnboardingField[] {
    return ONBOARDING_REQUIRED_FIELDS.filter((field) => {
        const value = profile[field];
        return value === undefined || value === null || value === '';
    });
}

export function isOnboardingComplete(
    profile: UserProfile['profile'],
): boolean {
    return getIncompleteOnboardingFields(profile).length === 0;
}
