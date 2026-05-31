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

        it('TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE — ПКУ розд. XIV гл. 1 (групи 1/2 заборонені для ТОВ)', () => {
            expect(
                getApiMessage('TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE', 'businesses')
            ).toBe(
                'Ця система оподаткування недоступна для обраного типу бізнесу'
            );
        });

        it.each([
            'TAXATION_NOT_APPLICABLE_FOR_TYPE',
            'TAXATION_REQUIRED_FOR_TYPE',
            'TAX_ID_FORMAT_MISMATCH_TYPE',
            'TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE',
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

    // Sprint 8 §8.3 — anon QR-preview throttle 10/min/IP. Окрема копія для
    // qr-module, бо generic копія використовує `{minutes}`-placeholder,
    // який frontend не має джерела для interpolate-у — без явної копії
    // користувач LAND-7 побачив би literal `{minutes}` у toast (regression).
    describe('Sprint 8 — qr.rate_limit_exceeded (placeholder-free)', () => {
        it('RATE_LIMIT_EXCEEDED у "qr"-module — повна копія без placeholder', () => {
            const msg = getApiMessage('RATE_LIMIT_EXCEEDED', 'qr');
            expect(msg).toBe(
                'Забагато запитів. Зачекайте хвилину і спробуйте ще раз'
            );
        });

        it('RATE_LIMIT_EXCEEDED у "qr"-module НЕ містить literal {minutes}-placeholder', () => {
            // Regression-guard для LAND-7. Без `errors.qr.rate_limit_exceeded`
            // mapping fall-through на `errors.generic.rate_limit_exceeded`,
            // де `'... через {minutes} хвилин'`. Frontend не передає vars
            // (TTL не доступний контексту), тож placeholder залишився б
            // literal у toast.
            const msg = getApiMessage('RATE_LIMIT_EXCEEDED', 'qr');
            expect(msg).not.toMatch(/\{minutes\}/);
        });

        it('RATE_LIMIT_EXCEEDED у "generic"-module все одно має placeholder (не break-имо інші callsite)', () => {
            // Якщо інший callsite (наприклад, generic-module fallback)
            // передає vars — interpolation працює як було.
            const msg = getApiMessage('RATE_LIMIT_EXCEEDED', 'generic', {
                minutes: 5,
            });
            expect(msg).toBe('Забагато запитів. Спробуйте через 5 хвилин');
        });
    });

    // Cabinet `default`-throttler 429 (60/min/IP). Сторінки businesses/
    // accounts/invoices викликають getApiMessage(code, module) без vars —
    // generic placeholder `{minutes}` протік би у UI як literal. Кожен
    // cabinet-модуль має placeholder-free копію (symmetric з qr-module).
    describe('cabinet rate_limit_exceeded (placeholder-free)', () => {
        it.each(['businesses', 'accounts', 'invoices'])(
            'RATE_LIMIT_EXCEEDED у "%s"-module — копія без literal {minutes}',
            (module) => {
                const msg = getApiMessage('RATE_LIMIT_EXCEEDED', module);
                expect(msg).toBe(
                    'Забагато запитів. Зачекайте хвилину і спробуйте ще раз'
                );
                expect(msg).not.toMatch(/\{minutes\}/);
            }
        );
    });
});
