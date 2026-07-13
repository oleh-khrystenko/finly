import { UserSchema } from './user';

const VALID_USER = {
    id: '507f1f77bcf86cd799439011',
    email: 'olha@example.com',
    profile: {
        firstName: 'Ольга',
        lastName: 'Іваненко',
    },
    hasPassword: true,
    createdAt: '2026-05-13T10:00:00.000Z',
};

describe('UserSchema', () => {
    it('parses a baseline user without pendingPostLoginTarget', () => {
        const result = UserSchema.safeParse(VALID_USER);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.pendingPostLoginTarget).toBeUndefined();
        }
    });

    it('parses a user with a valid same-origin pendingPostLoginTarget', () => {
        const result = UserSchema.safeParse({
            ...VALID_USER,
            pendingPostLoginTarget:
                '/business/ivanenko-fop/account/abcd1234',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.pendingPostLoginTarget).toBe(
                '/business/ivanenko-fop/account/abcd1234',
            );
        }
    });

    it('rejects a protocol-relative pendingPostLoginTarget', () => {
        const result = UserSchema.safeParse({
            ...VALID_USER,
            pendingPostLoginTarget: '//evil.com',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].message).toBe(
                'INVALID_REDIRECT_TARGET',
            );
        }
    });

    it('rejects an absolute https pendingPostLoginTarget', () => {
        const result = UserSchema.safeParse({
            ...VALID_USER,
            pendingPostLoginTarget: 'https://evil.com',
        });
        expect(result.success).toBe(false);
    });

    it('applies default profileCompletionReminders shape when field missing', () => {
        const result = UserSchema.safeParse(VALID_USER);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.profileCompletionReminders).toEqual({
                firstReminderSentAt: null,
                finalWarningSentAt: null,
            });
        }
    });

    it('parses profileCompletionReminders with non-null ISO-string stamps', () => {
        const result = UserSchema.safeParse({
            ...VALID_USER,
            profileCompletionReminders: {
                firstReminderSentAt: '2026-05-13T05:00:00.000Z',
                finalWarningSentAt: '2026-05-18T05:00:00.000Z',
            },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(
                result.data.profileCompletionReminders.firstReminderSentAt,
            ).toEqual(new Date('2026-05-13T05:00:00.000Z'));
            expect(
                result.data.profileCompletionReminders.finalWarningSentAt,
            ).toEqual(new Date('2026-05-18T05:00:00.000Z'));
        }
    });

    it('parses profileCompletionReminders with mixed null and Date stamp', () => {
        const result = UserSchema.safeParse({
            ...VALID_USER,
            profileCompletionReminders: {
                firstReminderSentAt: new Date('2026-05-13T05:00:00.000Z'),
                finalWarningSentAt: null,
            },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(
                result.data.profileCompletionReminders.firstReminderSentAt,
            ).toEqual(new Date('2026-05-13T05:00:00.000Z'));
            expect(
                result.data.profileCompletionReminders.finalWarningSentAt,
            ).toBeNull();
        }
    });
});
