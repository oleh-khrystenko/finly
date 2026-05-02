import { PayloadValidationError } from './errors';
import {
    PAYLOAD_003_FIELD_COUNT,
    build003Payload,
} from './payload-003';

const VALID_IBAN = 'UA213223130000026007233566001';
const VALID_IPN = '1234567899';

const baseInput = {
    receiverName: 'ФОП Іваненко',
    iban: VALID_IBAN,
    receiverTaxId: VALID_IPN,
    amountKopecks: 35000,
    purpose: 'Оплата консультації',
};

describe('build003Payload — структурна форма payload', () => {
    it('завжди генерує точно 17 полів', () => {
        const payload = build003Payload(baseInput);
        const lines = payload.split('\n');
        expect(lines).toHaveLength(PAYLOAD_003_FIELD_COUNT);
    });

    it('містить N-1 = 16 розділювачів `\\n` для N=17 полів', () => {
        const payload = build003Payload(baseInput);
        const newlineCount = (payload.match(/\n/g) ?? []).length;
        expect(newlineCount).toBe(PAYLOAD_003_FIELD_COUNT - 1);
    });

    it('фіксовані поля: BCD / 003 / 1 / UCT', () => {
        const payload = build003Payload(baseInput);
        const lines = payload.split('\n');
        expect(lines[0]).toBe('BCD');
        expect(lines[1]).toBe('003');
        expect(lines[2]).toBe('1');
        expect(lines[3]).toBe('UCT');
    });

    it('RFU-поля порожні: 5 (Унікальний ID), 17 (Електронний підпис)', () => {
        const payload = build003Payload(baseInput);
        const lines = payload.split('\n');
        expect(lines[4]).toBe('');
        expect(lines[16]).toBe('');
    });

    it('user-поля у правильних слотах: 6=name, 7=iban, 8=amount, 9=taxId, 12=purpose', () => {
        const payload = build003Payload(baseInput);
        const lines = payload.split('\n');
        expect(lines[5]).toBe('ФОП Іваненко');
        expect(lines[6]).toBe(VALID_IBAN);
        expect(lines[7]).toBe('UAH350');
        expect(lines[8]).toBe(VALID_IPN);
        expect(lines[11]).toBe('Оплата консультації');
    });

    it('за дефолтом: categoryPurpose = OTHR/GDDS, інші optional порожні', () => {
        const payload = build003Payload(baseInput);
        const lines = payload.split('\n');
        expect(lines[9]).toBe('OTHR/GDDS'); // 10: Категорія/ціль
        expect(lines[10]).toBe(''); // 11: Reference
        expect(lines[12]).toBe(''); // 13: Відображення
        expect(lines[13]).toBe(''); // 14: fieldLockMask
        expect(lines[14]).toBe(''); // 15: validUntil
        expect(lines[15]).toBe(''); // 16: issuedAt
    });
});

describe('build003Payload — golden vectors (8+ кейсів)', () => {
    it('1. ASCII-only minimum input', () => {
        const payload = build003Payload({
            ...baseInput,
            receiverName: 'FOP Test',
            purpose: 'Service payment',
        });
        const lines = payload.split('\n');
        expect(lines[5]).toBe('FOP Test');
        expect(lines[11]).toBe('Service payment');
    });

    it('2. UTF-8 cyrillic (типовий ФОП-кейс)', () => {
        const payload = build003Payload(baseInput);
        const lines = payload.split('\n');
        expect(lines[5]).toBe('ФОП Іваненко');
        expect(lines[11]).toBe('Оплата консультації');
    });

    it('3. amountKopecks = null → поле порожнє (клієнт вводить)', () => {
        const payload = build003Payload({
            ...baseInput,
            amountKopecks: null,
        });
        expect(payload.split('\n')[7]).toBe('');
    });

    it('4. amountKopecks = 0 → "UAH0"', () => {
        const payload = build003Payload({ ...baseInput, amountKopecks: 0 });
        expect(payload.split('\n')[7]).toBe('UAH0');
    });

    it('5. amountKopecks = 100 (рівне ціле грн) → "UAH1" (мінімізація)', () => {
        const payload = build003Payload({ ...baseInput, amountKopecks: 100 });
        expect(payload.split('\n')[7]).toBe('UAH1');
    });

    it('6. amountKopecks = 350 (3.50 грн) → "UAH3.50"', () => {
        const payload = build003Payload({ ...baseInput, amountKopecks: 350 });
        expect(payload.split('\n')[7]).toBe('UAH3.50');
    });

    it('7. amountKopecks = 305 (3.05 грн) → "UAH3.05"', () => {
        const payload = build003Payload({ ...baseInput, amountKopecks: 305 });
        expect(payload.split('\n')[7]).toBe('UAH3.05');
    });

    it('8. max-length receiverName (140 ASCII chars)', () => {
        const name = 'A'.repeat(140);
        const payload = build003Payload({ ...baseInput, receiverName: name });
        expect(payload.split('\n')[5]).toBe(name);
    });

    it('9. special chars у purpose («», №, апостроф)', () => {
        const purpose = 'Оплата за товари «Кав\'ярня» №147';
        const payload = build003Payload({ ...baseInput, purpose });
        expect(payload.split('\n')[11]).toBe(purpose);
    });

    it('10. function = ICT (миттєвий переказ)', () => {
        const payload = build003Payload({ ...baseInput, function: 'ICT' });
        expect(payload.split('\n')[3]).toBe('ICT');
    });

    it('11. function = XCT (вибір клієнтом)', () => {
        const payload = build003Payload({ ...baseInput, function: 'XCT' });
        expect(payload.split('\n')[3]).toBe('XCT');
    });

    it('12. categoryPurpose override (SUPP/SUPP — комунальні)', () => {
        const payload = build003Payload({
            ...baseInput,
            categoryPurpose: 'SUPP/SUPP',
        });
        expect(payload.split('\n')[9]).toBe('SUPP/SUPP');
    });

    it('13. reference (Оп.) заповнений', () => {
        const payload = build003Payload({
            ...baseInput,
            reference: 'INV-12345',
        });
        expect(payload.split('\n')[10]).toBe('INV-12345');
    });

    it('14. fieldLockMask = FEFF (дозволено редагувати лише суму)', () => {
        const payload = build003Payload({
            ...baseInput,
            fieldLockMask: 'FEFF',
        });
        expect(payload.split('\n')[13]).toBe('FEFF');
    });

    it('15. fieldLockMask = FFFF (заборонено все)', () => {
        const payload = build003Payload({
            ...baseInput,
            fieldLockMask: 'FFFF',
        });
        expect(payload.split('\n')[13]).toBe('FFFF');
    });

    it('16. validUntil + issuedAt (рахунок з терміном дії)', () => {
        const payload = build003Payload({
            ...baseInput,
            validUntil: '261231235959',
            issuedAt: '260501090000',
        });
        const lines = payload.split('\n');
        expect(lines[14]).toBe('261231235959');
        expect(lines[15]).toBe('260501090000');
    });
});

describe('build003Payload — детермінованість і чутливість', () => {
    it('однаковий input → однаковий output (детермінованість)', () => {
        const a = build003Payload(baseInput);
        const b = build003Payload(baseInput);
        expect(a).toBe(b);
    });

    it('різні input → різні output (sensitivity на категорію)', () => {
        const a = build003Payload(baseInput);
        const b = build003Payload({
            ...baseInput,
            categoryPurpose: 'SUPP/SUPP',
        });
        expect(a).not.toBe(b);
    });
});

describe('build003Payload — reject (per-field overflow)', () => {
    it('відхиляє receiverName overflow CHARS (141)', () => {
        expect(() =>
            build003Payload({
                ...baseInput,
                receiverName: 'A'.repeat(141),
            })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_FIELD_TOO_LONG_CHARS',
                field: 'receiverName',
                version: '003',
            })
        );
    });

    it('відхиляє reference overflow CHARS (36)', () => {
        expect(() =>
            build003Payload({ ...baseInput, reference: 'R'.repeat(36) })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_FIELD_TOO_LONG_CHARS',
                field: 'reference',
            })
        );
    });

    it('відхиляє display overflow CHARS (141)', () => {
        expect(() =>
            build003Payload({ ...baseInput, display: 'D'.repeat(141) })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_FIELD_TOO_LONG_CHARS',
                field: 'display',
            })
        );
    });
});

describe('build003Payload — reject NBU charset violations (Додаток 1 §I.4)', () => {
    it('відхиляє receiverName з \\n', () => {
        expect(() =>
            build003Payload({
                ...baseInput,
                receiverName: 'ФОП\nІваненко',
            })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_INVALID_CHARSET',
                field: 'receiverName',
                version: '003',
            })
        );
    });

    it('відхиляє reference з \\r', () => {
        expect(() =>
            build003Payload({
                ...baseInput,
                reference: 'INV\r12345',
            })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_INVALID_CHARSET',
                field: 'reference',
            })
        );
    });

    it('відхиляє display з emoji', () => {
        expect(() =>
            build003Payload({
                ...baseInput,
                display: 'Дисплей ☕',
            })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_INVALID_CHARSET',
                field: 'display',
            })
        );
    });

    it('приймає reference з ASCII-only (звичайний invoice ID)', () => {
        expect(() =>
            build003Payload({
                ...baseInput,
                reference: 'INV-2026-001',
            })
        ).not.toThrow();
    });
});

describe('build003Payload — reject (input format)', () => {
    it('відхиляє невалідний IBAN', () => {
        expect(() =>
            build003Payload({
                ...baseInput,
                iban: 'UA000000000000000000000000000',
            })
        ).toThrow(PayloadValidationError);
    });

    it('відхиляє невалідний categoryPurpose (не CCCC/PPPP)', () => {
        expect(() =>
            build003Payload({
                ...baseInput,
                categoryPurpose: 'OTHRGDDS',
            })
        ).toThrow(PayloadValidationError);
    });

    it('відхиляє невалідний fieldLockMask (5 hex замість 4)', () => {
        expect(() =>
            build003Payload({
                ...baseInput,
                fieldLockMask: 'FEFFA',
            })
        ).toThrow(PayloadValidationError);
    });

    it('відхиляє невалідний validUntil', () => {
        expect(() =>
            build003Payload({
                ...baseInput,
                validUntil: '2026-12-31',
            })
        ).toThrow(PayloadValidationError);
    });
});

describe('build003Payload — overall size assertion', () => {
    it('відхиляє payload, що перевищує 507 B (purpose 420 cyrillic = 840 B)', () => {
        const purpose = 'А'.repeat(420);
        expect(() => build003Payload({ ...baseInput, purpose })).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_OVERALL_SIZE_EXCEEDED',
                field: 'payload',
                version: '003',
            })
        );
    });
});

describe('cross-version: 003 з над-002-лімітом не падає (доказ незалежності версій)', () => {
    it('reference (003-only поле) у 002 ігнорується, але у 003 використовується', () => {
        // Reference є тільки в 003. У 002 поле 11 (Reference) — RFU/RFU-empty.
        // Якщо передаємо reference у input — 002 ignore, 003 використовує.
        const ref = 'INV-XXX-12345';
        const out003 = build003Payload({ ...baseInput, reference: ref });
        expect(out003.split('\n')[10]).toBe(ref);
    });
});
