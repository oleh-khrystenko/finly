import { getApiMessageKey } from './mapApiCode';

describe('getApiMessageKey', () => {
    it('returns notifications path for success code with module', () => {
        expect(getApiMessageKey('MAGIC_LINK_SENT', 'auth')).toBe(
            'notifications.auth.magic_link_sent'
        );
    });

    it('returns notifications path for other success codes', () => {
        expect(getApiMessageKey('LOGGED_OUT', 'auth')).toBe(
            'notifications.auth.logged_out'
        );
        expect(getApiMessageKey('PASSWORD_SET', 'auth')).toBe(
            'notifications.auth.password_set'
        );
        expect(getApiMessageKey('LANG_UPDATED', 'users')).toBe(
            'notifications.users.lang_updated'
        );
    });

    it('returns errors path for error code with module', () => {
        expect(getApiMessageKey('UNAUTHORIZED', 'auth')).toBe(
            'errors.auth.unauthorized'
        );
    });

    it('returns errors.generic path for error code without module', () => {
        expect(getApiMessageKey('UNAUTHORIZED')).toBe(
            'errors.generic.unauthorized'
        );
    });

    it('returns errors.generic path for unknown code without module', () => {
        expect(getApiMessageKey('UNKNOWN_CODE')).toBe(
            'errors.generic.unknown_code'
        );
    });

    it('returns errors path for unknown code with module (no type mapping)', () => {
        expect(getApiMessageKey('SOME_UNKNOWN', 'auth')).toBe(
            'errors.auth.some_unknown'
        );
    });

    it('lowercases the code in the key', () => {
        expect(getApiMessageKey('RATE_LIMIT_EXCEEDED', 'auth')).toBe(
            'errors.auth.rate_limit_exceeded'
        );
    });
});
