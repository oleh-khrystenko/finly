import { getApiMessage } from './mapApiCode';

describe('getApiMessage', () => {
    it('returns Ukrainian notification for success code with module', () => {
        expect(getApiMessage('MAGIC_LINK_SENT', 'auth')).toBe(
            'Посилання надіслано на вашу пошту'
        );
    });

    it('returns Ukrainian notification for other success codes', () => {
        expect(getApiMessage('LOGGED_OUT', 'auth')).toBe('Ви вийшли з акаунту');
        expect(getApiMessage('TERMS_ACCEPTED', 'users')).toBe(
            'Умови прийнято.'
        );
    });

    it('returns Ukrainian error message for auth error code', () => {
        expect(getApiMessage('UNAUTHORIZED', 'auth')).toBe(
            'Час сесії вичерпано. Увійдіть знову'
        );
    });

    it('falls back to unknown when no module and code has no generic entry', () => {
        expect(getApiMessage('UNAUTHORIZED')).toBe(
            'Сталася помилка. Спробуйте пізніше'
        );
    });

    it('returns generic unknown fallback for completely unknown code', () => {
        expect(getApiMessage('SOMETHING_WEIRD')).toBe(
            'Сталася помилка. Спробуйте пізніше'
        );
    });

    it('falls through to generic when module has no entry for code', () => {
        expect(getApiMessage('SOME_UNKNOWN', 'auth')).toBe(
            'Сталася помилка. Спробуйте пізніше'
        );
    });

    it('interpolates {minutes} placeholder for rate limit', () => {
        expect(
            getApiMessage('RATE_LIMIT_EXCEEDED', 'generic', { minutes: 15 })
        ).toBe('Забагато запитів. Спробуйте через 15 хвилин');
    });

    it('returns ЄДРПОУ-specific message for INVALID_LEGAL_TAX_ID', () => {
        // Sprint 7 §7.1 — окремий код для tov / organization структурної
        // помилки. Без цього мапінгу user бачив би UNKNOWN_FALLBACK
        // ("Сталася помилка"), що порушує `tone.md`.
        expect(getApiMessage('INVALID_LEGAL_TAX_ID', 'businesses')).toBe(
            'ЄДРПОУ має містити 8 цифр'
        );
    });

    // Sprint 7 §7.5 — service-layer cross-checks на UPDATE кидають
    // type-aware error-коди, що мусять мати UA-message-mapping. Без них
    // toast показав би raw machine-code (`TAXATION_NOT_APPLICABLE_FOR_TYPE`)
    // або UNKNOWN_FALLBACK, що блокує UAT PUB-6..9 + CAB-6 і порушує
    // `tone.md` "ніколи не показуй raw error-code".
    describe('Sprint 7 §7.5 — type-aware backend errors', () => {
        it('TAXATION_NOT_APPLICABLE_FOR_TYPE — forward-direction (поле зайве для типу)', () => {
            expect(
                getApiMessage('TAXATION_NOT_APPLICABLE_FOR_TYPE', 'businesses')
            ).toBe('Поля оподаткування недоступні для цього типу платника');
        });

        it("TAXATION_REQUIRED_FOR_TYPE — backward-direction (поле обов'язкове, не дозволяємо null-clear)", () => {
            expect(
                getApiMessage('TAXATION_REQUIRED_FOR_TYPE', 'businesses')
            ).toBe(
                'Оберіть систему оподаткування — вона обов’язкова для цього типу платника'
            );
        });

        it('TAX_ID_FORMAT_MISMATCH_TYPE — type-binding на PATCH requisites.taxId', () => {
            expect(
                getApiMessage('TAX_ID_FORMAT_MISMATCH_TYPE', 'businesses')
            ).toBe(
                'Код одержувача не відповідає формату для цього типу платника'
            );
        });

        it.each([
            'TAXATION_NOT_APPLICABLE_FOR_TYPE',
            'TAXATION_REQUIRED_FOR_TYPE',
            'TAX_ID_FORMAT_MISMATCH_TYPE',
            'INVALID_LEGAL_TAX_ID',
        ])(
            'код %s НЕ повертає UNKNOWN_FALLBACK (raw-code-leak guard)',
            (code) => {
                const msg = getApiMessage(code, 'businesses');
                expect(msg).not.toBe('Сталася помилка. Спробуйте пізніше');
                // А також не порожній і не raw machine-code:
                expect(msg.length).toBeGreaterThan(0);
                expect(msg).not.toBe(code);
            }
        );
    });

    // Sprint 8 fix — overall payload-size overflow при build NBU-payload.
    // Backend `AllExceptionsFilter` мапить `PayloadValidationError` на 400
    // з `RESPONSE_CODE.PAYLOAD_TOO_LARGE`; frontend має actionable UA-message.
    describe('Sprint 8 — qr.payload_too_large', () => {
        it('PAYLOAD_TOO_LARGE — actionable UA-рекомендація', () => {
            const msg = getApiMessage('PAYLOAD_TOO_LARGE', 'qr');
            expect(msg).toBe(
                'Ваші дані не вміщуються в платіжний QR-код. Скоротіть назву або призначення платежу'
            );
        });

        it('PAYLOAD_TOO_LARGE НЕ повертає UNKNOWN_FALLBACK (raw-code-leak guard)', () => {
            const msg = getApiMessage('PAYLOAD_TOO_LARGE', 'qr');
            expect(msg).not.toBe('Сталася помилка. Спробуйте пізніше');
            expect(msg).not.toBe('PAYLOAD_TOO_LARGE');
            expect(msg).toMatch(/[А-Яа-яҐґЄєІіЇї]/);
        });
    });
});
