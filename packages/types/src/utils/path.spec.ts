import { validateSameOriginPath } from './path';

describe('validateSameOriginPath', () => {
    describe('valid same-origin paths', () => {
        it('accepts a plain root path', () => {
            expect(validateSameOriginPath('/business')).toBe(true);
        });

        it('accepts a path with query string', () => {
            expect(
                validateSameOriginPath(
                    '/business/foo/account/bar?ref=invite',
                ),
            ).toBe(true);
        });

        it('accepts a nested path', () => {
            expect(validateSameOriginPath('/profile/me')).toBe(true);
        });

        it('accepts the bare root with query', () => {
            expect(validateSameOriginPath('/?next=foo')).toBe(true);
        });

        it('accepts a path with hash fragment', () => {
            expect(validateSameOriginPath('/business#section')).toBe(true);
        });
    });

    describe('invalid open-redirect candidates', () => {
        it('rejects protocol-relative URL', () => {
            expect(validateSameOriginPath('//evil.com')).toBe(false);
        });

        it('rejects absolute http URL', () => {
            expect(validateSameOriginPath('http://evil.com')).toBe(false);
        });

        it('rejects absolute https URL', () => {
            expect(validateSameOriginPath('https://evil.com')).toBe(false);
        });

        it('rejects bare hostname without scheme', () => {
            expect(validateSameOriginPath('evil.com')).toBe(false);
        });

        it('rejects an empty string', () => {
            expect(validateSameOriginPath('')).toBe(false);
        });
    });
});
