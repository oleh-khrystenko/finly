import { mapValidationCode } from './mapValidationCode';

/**
 * `mapValidationCode` — frontend-side mapper для inline-Zod-помилок
 * (RHF resolver-output → user-facing UA-string). Тести нижче гарантують:
 *
 *  1. Sprint 7 type-aware коди мають UA-mapping (без UNKNOWN_FALLBACK leak-у).
 *  2. Невідомий код → fallback "Перевірте правильність значення", не raw
 *     machine-code (захист від нових Zod-помилок, що додаються без
 *     оновлення словника).
 *  3. Empty / undefined input → undefined (RHF / UI рендерять "немає
 *     помилки", не порожній рядок-помилку).
 */
describe('mapValidationCode', () => {
    describe('Sprint 7 — type-aware inline error codes', () => {
        it('INVALID_LEGAL_TAX_ID → ЄДРПОУ-specific повідомлення', () => {
            expect(mapValidationCode('INVALID_LEGAL_TAX_ID')).toBe(
                'Перевірте ЄДРПОУ: рівно 8 цифр'
            );
        });

        it('INVALID_TAX_ID — РНОКПП-specific повідомлення (не змінилося Sprint 7)', () => {
            expect(mapValidationCode('INVALID_TAX_ID')).toBe(
                'У РНОКПП є помилка. Перевірте всі 10 цифр'
            );
        });

        it('TAXATION_FIELDS_MISMATCH_TYPE — read-side iff-refine UA-string', () => {
            // Sprint 7 §SP-3 — entity-Zod refine код. Завжди звичайний user
            // через wizard-форму його не побачить (write-DTO discriminated
            // union відсікає таку комбінацію раніше); код призначений для
            // curl-ів і safety-net read-side.
            expect(mapValidationCode('TAXATION_FIELDS_MISMATCH_TYPE')).toBe(
                'Поля оподаткування не відповідають типу платника'
            );
        });

        it('TAX_ID_FORMAT_MISMATCH_TYPE — entity-Zod refine для type-binding', () => {
            expect(mapValidationCode('TAX_ID_FORMAT_MISMATCH_TYPE')).toBe(
                'Код одержувача не відповідає формату для цього типу платника'
            );
        });

        it('TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE — ПКУ розд. XIV гл. 1', () => {
            expect(
                mapValidationCode('TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE')
            ).toBe(
                'Ця система оподаткування недоступна для обраного типу отримувача'
            );
        });

        it.each([
            'INVALID_LEGAL_TAX_ID',
            'TAXATION_FIELDS_MISMATCH_TYPE',
            'TAX_ID_FORMAT_MISMATCH_TYPE',
            'TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE',
        ])('%s НЕ повертає raw machine-code (UI leak guard)', (code) => {
            const msg = mapValidationCode(code);
            expect(msg).toBeDefined();
            expect(msg).not.toBe(code);
            // Sanity: повідомлення містить кириличні символи (UA-localized).
            expect(msg).toMatch(/[А-Яа-яҐґЄєІіЇї]/);
        });
    });

    describe('Sprint 8 — NBU-charset refine коди', () => {
        it('INVALID_NAME_CHARSET — UX-рекомендація прибрати спеціальні символи', () => {
            const msg = mapValidationCode('INVALID_NAME_CHARSET');
            expect(msg).toBeDefined();
            // Повідомлення не дублює CHAR_LENGTH/BYTE_LENGTH ("скоротіть"),
            // а спрямовує на прибирання символів — рекомендація, що відрізняє
            // charset-помилку від length-overflow на UX-рівні.
            expect(msg).toMatch(/символ/i);
            expect(msg).not.toBe('Перевірте правильність значення');
        });

        it('INVALID_PURPOSE_CHARSET — UX-рекомендація прибрати спеціальні символи', () => {
            const msg = mapValidationCode('INVALID_PURPOSE_CHARSET');
            expect(msg).toBeDefined();
            expect(msg).toMatch(/символ/i);
            expect(msg).not.toBe('Перевірте правильність значення');
        });

        it.each(['INVALID_NAME_CHARSET', 'INVALID_PURPOSE_CHARSET'])(
            '%s НЕ повертає raw machine-code (UI leak guard)',
            (code) => {
                const msg = mapValidationCode(code);
                expect(msg).toBeDefined();
                expect(msg).not.toBe(code);
                expect(msg).toMatch(/[А-Яа-яҐґЄєІіЇї]/);
            }
        );
    });

    describe('Sprint 1+3 — baseline-коди (regression guard)', () => {
        it.each([
            [
                'INVALID_IBAN_FORMAT',
                'Здається, номер IBAN неповний або введений з помилкою. Перевірте його',
            ],
            [
                'INVALID_IBAN_CHECKSUM',
                'Номер IBAN недійсний. Звірте кожну цифру з реквізитами: найчастіше це описка в одній цифрі',
            ],
            ['INVALID_NAME_REQUIRED', 'Введіть назву'],
            ['INVALID_PURPOSE_REQUIRED', 'Введіть призначення платежу'],
            [
                'INVALID_VAT_FOR_TAXATION_SYSTEM',
                'Платник ПДВ можливий лише на спрощеній-3 або загальній системі',
            ],
            [
                'OWNERLESS_BUSINESS_REQUIRES_MANAGER',
                'Додайте хоча б одного керівника',
            ],
        ])('%s → %s', (code, expected) => {
            expect(mapValidationCode(code)).toBe(expected);
        });
    });

    describe('Fallback semantic', () => {
        it('Невідомий код → generic fallback (не raw machine-code)', () => {
            expect(mapValidationCode('TOTALLY_UNKNOWN_CODE')).toBe(
                'Перевірте правильність значення'
            );
        });

        it('undefined input → undefined (RHF "no error" semantic)', () => {
            expect(mapValidationCode(undefined)).toBeUndefined();
        });

        it('Порожній рядок → undefined (RHF "no error" semantic)', () => {
            expect(mapValidationCode('')).toBeUndefined();
        });
    });
});
