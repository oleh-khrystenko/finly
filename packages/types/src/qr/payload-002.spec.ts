import { PayloadValidationError } from './errors';
import { PAYLOAD_002_FIELD_COUNT, build002Payload } from './payload-002';

const VALID_IBAN = 'UA213223130000026007233566001';
const VALID_IPN = '1234567899';

const baseInput = {
    receiverName: 'ФОП Іваненко',
    iban: VALID_IBAN,
    receiverTaxId: VALID_IPN,
    amountKopecks: 35000,
    purpose: 'Оплата консультації',
};

describe('build002Payload — структурна форма payload', () => {
    it('завжди генерує точно 13 полів (trailing-empty критично)', () => {
        const payload = build002Payload(baseInput);
        const lines = payload.split('\n');
        expect(lines).toHaveLength(PAYLOAD_002_FIELD_COUNT);
    });

    it('містить N-1 = 12 розділювачів `\\n` для N=13 полів', () => {
        const payload = build002Payload(baseInput);
        const newlineCount = (payload.match(/\n/g) ?? []).length;
        expect(newlineCount).toBe(PAYLOAD_002_FIELD_COUNT - 1);
    });

    it('фіксовані поля: BCD / 002 / 1 / UCT', () => {
        const payload = build002Payload(baseInput);
        const lines = payload.split('\n');
        expect(lines[0]).toBe('BCD');
        expect(lines[1]).toBe('002');
        expect(lines[2]).toBe('1');
        expect(lines[3]).toBe('UCT');
    });

    it('RFU-поля порожні: 5 (BIC), 10 (Ціль), 11 (Reference), 13 (Відображення)', () => {
        const payload = build002Payload(baseInput);
        const lines = payload.split('\n');
        expect(lines[4]).toBe('');
        expect(lines[9]).toBe('');
        expect(lines[10]).toBe('');
        expect(lines[12]).toBe('');
    });

    it('user-поля у правильних слотах: 6=name, 7=iban, 8=amount, 9=taxId, 12=purpose', () => {
        const payload = build002Payload(baseInput);
        const lines = payload.split('\n');
        expect(lines[5]).toBe('ФОП Іваненко');
        expect(lines[6]).toBe(VALID_IBAN);
        expect(lines[7]).toBe('UAH350');
        expect(lines[8]).toBe(VALID_IPN);
        expect(lines[11]).toBe('Оплата консультації');
    });
});

describe('build002Payload — golden vectors (8+ кейсів)', () => {
    it('1. ASCII-only minimum input', () => {
        const payload = build002Payload({
            ...baseInput,
            receiverName: 'FOP Test',
            purpose: 'Service payment',
        });
        expect(payload).toBe(
            [
                'BCD',
                '002',
                '1',
                'UCT',
                '',
                'FOP Test',
                VALID_IBAN,
                'UAH350',
                VALID_IPN,
                '',
                '',
                'Service payment',
                '',
            ].join('\n')
        );
    });

    it('2. UTF-8 cyrillic (типовий ФОП-кейс)', () => {
        const payload = build002Payload(baseInput);
        expect(payload.split('\n')[5]).toBe('ФОП Іваненко');
        expect(payload.split('\n')[11]).toBe('Оплата консультації');
    });

    it('3. amountKopecks = null → поле порожнє (клієнт вводить)', () => {
        const payload = build002Payload({
            ...baseInput,
            amountKopecks: null,
        });
        expect(payload.split('\n')[7]).toBe('');
    });

    it('4. amountKopecks = 0 → "UAH0"', () => {
        const payload = build002Payload({ ...baseInput, amountKopecks: 0 });
        expect(payload.split('\n')[7]).toBe('UAH0');
    });

    it('5. amountKopecks = 100 (рівне ціле грн) → "UAH1" (мінімізація без ".00")', () => {
        const payload = build002Payload({ ...baseInput, amountKopecks: 100 });
        expect(payload.split('\n')[7]).toBe('UAH1');
    });

    it('6. amountKopecks = 350 (3.50 грн) → "UAH3.50"', () => {
        const payload = build002Payload({ ...baseInput, amountKopecks: 350 });
        expect(payload.split('\n')[7]).toBe('UAH3.50');
    });

    it('7. amountKopecks = 305 (3.05 грн) → "UAH3.05" (zero-padded копійки)', () => {
        const payload = build002Payload({ ...baseInput, amountKopecks: 305 });
        expect(payload.split('\n')[7]).toBe('UAH3.05');
    });

    it('8. amountKopecks = max (999_999_999.99) → "UAH999999999.99"', () => {
        const payload = build002Payload({
            ...baseInput,
            amountKopecks: 99_999_999_999,
        });
        expect(payload.split('\n')[7]).toBe('UAH999999999.99');
    });

    it('9. max-length receiverName (140 ASCII chars)', () => {
        const name = 'A'.repeat(140);
        const payload = build002Payload({ ...baseInput, receiverName: name });
        expect(payload.split('\n')[5]).toBe(name);
    });

    it('10. max-length purpose (420 ASCII) з коротким ASCII receiverName', () => {
        // Норматив дозволяє name 140C і purpose 420C незалежно, але разом вони
        // можуть перевищити overall 507 B. Тестуємо max purpose з лаконічним
        // ASCII name, щоб per-field max-boundary був витриманий, а сумарно
        // payload влiз.
        const purpose = 'P'.repeat(420);
        const payload = build002Payload({
            ...baseInput,
            receiverName: 'FOP A',
            purpose,
        });
        expect(payload.split('\n')[11]).toBe(purpose);
    });

    it('11. special chars у purpose («», № апостроф)', () => {
        const purpose = "Оплата за товари «Кав'ярня» №147";
        const payload = build002Payload({ ...baseInput, purpose });
        expect(payload.split('\n')[11]).toBe(purpose);
    });

    it('12. multi-word receiverName з тире і капіталами', () => {
        const name = 'ФОП Іваненко-Експрес-Перевезення';
        const payload = build002Payload({ ...baseInput, receiverName: name });
        expect(payload.split('\n')[5]).toBe(name);
    });
});

describe('build002Payload — детермінованість і чутливість', () => {
    it('однаковий input → однаковий output (детермінованість)', () => {
        const a = build002Payload(baseInput);
        const b = build002Payload(baseInput);
        expect(a).toBe(b);
    });

    it('різні input → різні output (sensitivity)', () => {
        const a = build002Payload(baseInput);
        const b = build002Payload({
            ...baseInput,
            receiverName: 'Інший ФОП',
        });
        expect(a).not.toBe(b);
    });
});

describe('build002Payload — reject (per-field overflow)', () => {
    it('відхиляє receiverName overflow CHARS (141 ASCII)', () => {
        expect(() =>
            build002Payload({
                ...baseInput,
                receiverName: 'A'.repeat(141),
            })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_FIELD_TOO_LONG_CHARS',
                field: 'receiverName',
                version: '002',
            })
        );
    });

    it('приймає 140 cyrillic chars (точно на межі: 140C / 280B)', () => {
        const name = 'А'.repeat(140);
        expect(() =>
            build002Payload({ ...baseInput, receiverName: name })
        ).not.toThrow();
    });

    // BYTES-overflow без charset-violation важко відтворити: всі allowed-chars
    // у NBU-charset або 1-byte (ASCII), або 2-byte (cyrillic/typo specials).
    // Натуральний BYTES-overflow без CHARS-overflow вимагав би 3-byte char у allowed
    // charset; типографські U+2013/U+2014/U+201A тощо — точно 3-byte у UTF-8.
    it('відхиляє receiverName з BYTES overflow на 3-byte chars при граничному chars-count', () => {
        // 95 ASCII (95 B) + 45 апострофів U+2019 (45 chars × 3 B = 135 B) = 140 chars / 230 B.
        // Не overflow. Підвищуємо до 100 ASCII + 40 × U+2019 = 140 chars / 220 B → нижче 280, valid.
        // Чистий BYTES overflow: 50 ASCII + 90 × U+2019 = 140 chars, byte = 50+270=320 > 280.
        const name = 'A'.repeat(50) + '’'.repeat(90);
        expect(() =>
            build002Payload({ ...baseInput, receiverName: name })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_FIELD_TOO_LONG_BYTES',
                field: 'receiverName',
            })
        );
    });

    it('відхиляє purpose overflow CHARS (421 ASCII)', () => {
        expect(() =>
            build002Payload({ ...baseInput, purpose: 'P'.repeat(421) })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_FIELD_TOO_LONG_CHARS',
                field: 'purpose',
            })
        );
    });
});

describe('build002Payload — reject NBU charset violations (Додаток 1 §I.4)', () => {
    it('відхиляє receiverName з \\n (роздільник полів — ламає QR structure)', () => {
        expect(() =>
            build002Payload({
                ...baseInput,
                receiverName: 'ФОП\nІваненко',
            })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_INVALID_CHARSET',
                field: 'receiverName',
                version: '002',
            })
        );
    });

    it('відхиляє purpose з \\r (CR також роздільник)', () => {
        expect(() =>
            build002Payload({ ...baseInput, purpose: 'Оплата\rза товар' })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_INVALID_CHARSET',
                field: 'purpose',
            })
        );
    });

    it('відхиляє receiverName з emoji ☕ (поза Win1251 mapping)', () => {
        expect(() =>
            build002Payload({ ...baseInput, receiverName: 'ФОП ☕ Кафе' })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_INVALID_CHARSET',
                field: 'receiverName',
            })
        );
    });

    it('відхиляє receiverName з NBSP (U+00A0 явно заборонено нормативом)', () => {
        expect(() =>
            build002Payload({
                ...baseInput,
                receiverName: 'ФОП Іваненко',
            })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_INVALID_CHARSET',
            })
        );
    });

    it('відхиляє receiverName з tab (\\t — control char)', () => {
        expect(() =>
            build002Payload({
                ...baseInput,
                receiverName: 'ФОП\tІваненко',
            })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_INVALID_CHARSET',
            })
        );
    });

    it('приймає типографські символи з Win1251-mapping (« » № — № – —)', () => {
        expect(() =>
            build002Payload({
                ...baseInput,
                receiverName: "ТОВ «Кав'ярня»",
                purpose: 'Оплата за замовлення №147 — товари',
            })
        ).not.toThrow();
    });

    it('приймає всі базові кириличні літери (А-я + Ґ/ґ/Є/є/І/і/Ї/ї)', () => {
        expect(() =>
            build002Payload({
                ...baseInput,
                receiverName:
                    'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя',
            })
        ).not.toThrow();
    });
});

describe('build002Payload — reject (input format)', () => {
    it('відхиляє невалідний IBAN', () => {
        expect(() =>
            build002Payload({
                ...baseInput,
                iban: 'UA000000000000000000000000000',
            })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_INVALID_FIELD_FORMAT',
                field: 'iban',
                version: '002',
            })
        );
    });

    it('відхиляє amountKopecks > нормативного максимуму', () => {
        expect(() =>
            build002Payload({
                ...baseInput,
                amountKopecks: 99_999_999_999 + 1,
            })
        ).toThrow(PayloadValidationError);
    });
});

describe('build002Payload — overall size assertion', () => {
    it('відхиляє payload, що сумарно перевищує 507 B (purpose 420 cyrillic = 840 B)', () => {
        // 420 cyrillic chars valid per-field (chars 420 ≤ 420, bytes 840 ≤ 840),
        // але з іншими полями payload впевнено > 507 B.
        const purpose = 'А'.repeat(420);
        expect(() => build002Payload({ ...baseInput, purpose })).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_OVERALL_SIZE_EXCEEDED',
                field: 'payload',
                version: '002',
            })
        );
    });
});

describe('build002Payload — ігнорує 003-only поля', () => {
    it('extra-input з 003-полями не впливає на payload', () => {
        const minimal = build002Payload(baseInput);
        const extra = build002Payload({
            ...baseInput,
            function: 'ICT',
            categoryPurpose: 'SUPP/SUPP',
            reference: 'INV-12345',
            display: 'Дисплей',
            fieldLockMask: 'FFFF',
            validUntil: '261231235959',
            issuedAt: '260501090000',
        });
        expect(minimal).toBe(extra);
    });
});
