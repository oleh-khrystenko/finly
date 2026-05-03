import { UpdateProfileSchema } from './users';

describe('UpdateProfileSchema', () => {
    it('accepts empty object (no-op)', () => {
        const result = UpdateProfileSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    it('accepts single-field firstName update', () => {
        const result = UpdateProfileSchema.safeParse({ firstName: 'Олег' });
        expect(result.success).toBe(true);
    });

    it('accepts worksAsBookkeeper toggle (Sprint 3 E5) — without Paid-gating', () => {
        const result = UpdateProfileSchema.safeParse({
            worksAsBookkeeper: true,
        });
        expect(result.success).toBe(true);
    });

    it('accepts worksAsBookkeeper=false', () => {
        const result = UpdateProfileSchema.safeParse({
            worksAsBookkeeper: false,
        });
        expect(result.success).toBe(true);
    });

    it('rejects worksAsBookkeeper як non-boolean (string "true")', () => {
        const result = UpdateProfileSchema.safeParse({
            worksAsBookkeeper: 'true',
        });
        expect(result.success).toBe(false);
    });

    it('accepts coupled update (firstName + worksAsBookkeeper в одному PATCH)', () => {
        const result = UpdateProfileSchema.safeParse({
            firstName: 'Олег',
            worksAsBookkeeper: true,
        });
        expect(result.success).toBe(true);
    });
});
