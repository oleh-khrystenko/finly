import { getApiMessage } from './mapApiCode';

describe('getApiMessage', () => {
    it('returns Ukrainian notification for success code with module', () => {
        expect(getApiMessage('MAGIC_LINK_SENT', 'auth')).toBe(
            'Посилання надіслано на вашу пошту',
        );
    });

    it('returns Ukrainian notification for other success codes', () => {
        expect(getApiMessage('LOGGED_OUT', 'auth')).toBe(
            'Ви вийшли з акаунту',
        );
        expect(getApiMessage('TERMS_ACCEPTED', 'users')).toBe(
            'Умови прийнято.',
        );
    });

    it('returns Ukrainian error message for auth error code', () => {
        expect(getApiMessage('UNAUTHORIZED', 'auth')).toBe(
            'Час сесії вичерпано. Увійдіть знову',
        );
    });

    it('falls back to unknown when no module and code has no generic entry', () => {
        expect(getApiMessage('UNAUTHORIZED')).toBe(
            'Сталася помилка. Спробуйте пізніше',
        );
    });

    it('returns generic unknown fallback for completely unknown code', () => {
        expect(getApiMessage('SOMETHING_WEIRD')).toBe(
            'Сталася помилка. Спробуйте пізніше',
        );
    });

    it('falls through to generic when module has no entry for code', () => {
        expect(getApiMessage('SOME_UNKNOWN', 'auth')).toBe(
            'Сталася помилка. Спробуйте пізніше',
        );
    });

    it('interpolates {minutes} placeholder for rate limit', () => {
        expect(
            getApiMessage('RATE_LIMIT_EXCEEDED', 'generic', { minutes: 15 }),
        ).toBe('Забагато запитів. Спробуйте через 15 хвилин');
    });
});
