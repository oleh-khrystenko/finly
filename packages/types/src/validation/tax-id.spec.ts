import {
    individualTaxIdZod,
    isValidIndividualTaxId,
    legalEntityTaxIdZod,
    payerTaxIdZod,
} from './tax-id';

describe('isValidIndividualTaxId — golden vectors', () => {
    // Валідні ІПН, у яких 10-та цифра відповідає алгоритму ДПС
    // (ваги [-1, 5, 7, 9, 4, 6, 10, 5, 7], (Σ mod 11) mod 10).
    const validTaxIds = [
        '1234567899',
        '9876543215',
        '3010101118',
        '2020202020',
        '1112223335',
        '4455667789',
        '9000000002',
    ];

    it.each(validTaxIds)('accepts valid IPN %s', (taxId) => {
        expect(isValidIndividualTaxId(taxId)).toBe(true);
        expect(individualTaxIdZod.safeParse(taxId).success).toBe(true);
    });

    // Невалідні — кожен покриває окремий failure-mode
    const invalidTaxIds: ReadonlyArray<[string, string]> = [
        ['1234567890', 'wrong check digit'],
        ['9876543210', 'wrong check digit (off by 5)'],
        ['12345', 'too short'],
        ['12345678901', 'too long'],
        ['abcdefghij', 'non-digit characters'],
        ['123456789a', 'mixed digit/letter'],
        ['1234 567899', 'embedded space'],
        ['', 'empty string'],
    ];

    it.each(invalidTaxIds)('rejects invalid IPN %s (%s)', (taxId) => {
        expect(isValidIndividualTaxId(taxId)).toBe(false);
        expect(individualTaxIdZod.safeParse(taxId).success).toBe(false);
    });

    it('rejects non-string input via the runtime guard', () => {
        expect(isValidIndividualTaxId(undefined as unknown as string)).toBe(
            false
        );
        expect(isValidIndividualTaxId(null as unknown as string)).toBe(false);
        expect(isValidIndividualTaxId(1234567899 as unknown as string)).toBe(
            false
        );
    });

    it('emits the contract error code on schema rejection', () => {
        const result = individualTaxIdZod.safeParse('1234567890');
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toBe('INVALID_TAX_ID');
        }
    });
});

describe('legalEntityTaxIdZod — ЄДРПОУ (8 digits, no checksum)', () => {
    // Sprint 7 §SP-2: жодного checksum-validation на MVP. Валідні рядки —
    // будь-яка послідовність з рівно 8 десяткових цифр (тести fixate цей
    // contract; зміна на checksum-mode пізніше — окремий tech-backlog ticket).
    const valid = [
        '12345678',
        '00000000',
        '99999999',
        '20000000', // legacy-формат з 1992 (державні підприємства починалися з 2)
        '40000000', // ОСББ-кейс (приклад зі staging-фікстур sprint-плану)
    ];

    it.each(valid)('accepts %s', (taxId) => {
        expect(legalEntityTaxIdZod.safeParse(taxId).success).toBe(true);
    });

    const invalid: ReadonlyArray<[string, string]> = [
        ['1234567', 'too short (7 digits)'],
        ['123456789', 'too long (9 digits)'],
        ['', 'empty string'],
        ['abc12345', 'leading letters'],
        ['12345abc', 'trailing letters'],
        ['1234 567', 'embedded space'],
        ['12345678 ', 'trailing space'],
        [' 12345678', 'leading space'],
        ['1234.567', 'punctuation in middle'],
    ];

    it.each(invalid)('rejects %s (%s)', (taxId) => {
        expect(legalEntityTaxIdZod.safeParse(taxId).success).toBe(false);
    });

    it('emits the contract error code on schema rejection', () => {
        const result = legalEntityTaxIdZod.safeParse('1234567');
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toBe(
                'INVALID_LEGAL_TAX_ID'
            );
        }
    });
});

describe('payerTaxIdZod — union(individual 10-digit + checksum, legal 8-digit)', () => {
    // SP-10: один валідатор для NBU `PayloadInputSchema.receiverTaxId`, що
    // приймає обидва легальних формати. Issue-code mapping per-варіант не
    // важливий тут (consumer-side validation на cabinet-формах вибирає
    // konkrétно один з них).
    it.each([
        ['1234567899', 'individual 10-digit with valid checksum'],
        ['9000000002', 'individual edge-case (sum mod 11 == 10 → 0)'],
        ['12345678', 'legal entity 8-digit'],
        ['00000000', 'legal entity all-zeroes'],
    ])('accepts %s (%s)', (value) => {
        expect(payerTaxIdZod.safeParse(value).success).toBe(true);
    });

    it.each([
        ['1234567890', 'individual 10-digit with WRONG checksum'],
        ['1234567', '7 digits — fits neither'],
        ['123456789', '9 digits — fits neither'],
        ['12345678901', '11 digits — fits neither'],
        ['', 'empty string'],
        ['abcdefgh', '8 letters'],
        ['1234567a', 'mixed in 8-position slot'],
    ])('rejects %s (%s)', (value) => {
        expect(payerTaxIdZod.safeParse(value).success).toBe(false);
    });
});
