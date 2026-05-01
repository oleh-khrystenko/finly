import { individualTaxIdZod, isValidIndividualTaxId } from './tax-id';

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
        expect(
            isValidIndividualTaxId(undefined as unknown as string)
        ).toBe(false);
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
