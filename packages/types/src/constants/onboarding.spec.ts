import {
    ONBOARDING_REQUIRED_FIELDS,
    getIncompleteOnboardingFields,
    isOnboardingComplete,
} from './onboarding';

describe('Onboarding required fields', () => {
    it('lists firstName and lastName as required', () => {
        expect(ONBOARDING_REQUIRED_FIELDS).toEqual(['firstName', 'lastName']);
    });

    describe('isOnboardingComplete (read-path mirrors write-path schema)', () => {
        it('returns true when all required fields are present', () => {
            expect(
                isOnboardingComplete({
                    firstName: 'Іван',
                    lastName: 'Іваненко',
                })
            ).toBe(true);
        });

        it('returns false when lastName is missing', () => {
            expect(isOnboardingComplete({ firstName: 'Іван' })).toBe(false);
        });

        it('returns false when firstName is missing', () => {
            expect(isOnboardingComplete({ lastName: 'Іваненко' })).toBe(false);
        });

        it('returns false when lastName is empty string', () => {
            expect(
                isOnboardingComplete({ firstName: 'Іван', lastName: '' })
            ).toBe(false);
        });

        it('returns false when lastName is whitespace-only (must trim before checking)', () => {
            expect(
                isOnboardingComplete({ firstName: 'Іван', lastName: '   ' })
            ).toBe(false);
        });

        it('returns false when firstName is whitespace-only', () => {
            expect(
                isOnboardingComplete({ firstName: '   ', lastName: 'Іваненко' })
            ).toBe(false);
        });

        it('returns false when firstName is single-char (firstNameSchema requires min 2)', () => {
            expect(
                isOnboardingComplete({ firstName: 'І', lastName: 'Іваненко' })
            ).toBe(false);
        });

        it('returns true when lastName is single-char (lastNameSchema is non-empty per sprint plan)', () => {
            expect(
                isOnboardingComplete({ firstName: 'Іван', lastName: 'І' })
            ).toBe(true);
        });

        it('returns false when lastName contains digits (regex restricts to letters/spaces/hyphens/apostrophes)', () => {
            expect(
                isOnboardingComplete({ firstName: 'Іван', lastName: 'Іван3' })
            ).toBe(false);
        });

        it('returns false when profile is empty', () => {
            expect(isOnboardingComplete({})).toBe(false);
        });
    });

    describe('getIncompleteOnboardingFields', () => {
        it('reports empty list when complete', () => {
            expect(
                getIncompleteOnboardingFields({
                    firstName: 'Іван',
                    lastName: 'Іваненко',
                })
            ).toEqual([]);
        });

        it('reports missing lastName specifically', () => {
            expect(
                getIncompleteOnboardingFields({ firstName: 'Іван' })
            ).toEqual(['lastName']);
        });

        it('reports both fields when profile is empty', () => {
            expect(getIncompleteOnboardingFields({})).toEqual([
                'firstName',
                'lastName',
            ]);
        });

        it('reports lastName when whitespace-only (parity with form validation)', () => {
            expect(
                getIncompleteOnboardingFields({
                    firstName: 'Іван',
                    lastName: '\t\n  ',
                })
            ).toEqual(['lastName']);
        });
    });
});
