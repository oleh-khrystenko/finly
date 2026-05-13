import { UserSchema } from './user';

const VALID_USER = {
    id: '507f1f77bcf86cd799439011',
    email: 'olha@example.com',
    profile: {
        firstName: 'Ольга',
        lastName: 'Іваненко',
    },
    executions: {
        balance: 0,
        freeReportUsed: false,
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
                '/business/ivanenko-fop/account/abcd1234?completed-from=landing',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.pendingPostLoginTarget).toBe(
                '/business/ivanenko-fop/account/abcd1234?completed-from=landing',
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
});
