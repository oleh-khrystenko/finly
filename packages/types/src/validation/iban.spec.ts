import { ibanZod, isValidIban } from './iban';

describe('isValidIban — golden vectors', () => {
    // Валідні UA-IBAN, обчислені під ISO 7064 Mod 97-10. Перші два — публічні
    // synthetic-приклади з документації / wikipedia, інші згенеровані з різних
    // префіксів банків (305*, 322*, 320*, 300*) для покриття простору значень.
    const validIbans = [
        'UA213223130000026007233566001',
        'UA213996220000026007233566001',
        'UA273052992990004149497786452',
        'UA053220010000026005340179996',
        'UA113052992200000260043025001',
        'UA523052990000026003123456789',
        'UA713209840000026000000000001',
        'UA093000010000026007299999999',
    ];

    it.each(validIbans)('accepts valid IBAN %s', (iban) => {
        expect(isValidIban(iban)).toBe(true);
        expect(ibanZod.safeParse(iban).success).toBe(true);
    });

    // Невалідні — кожен покриває окремий failure-mode
    const invalidIbans: ReadonlyArray<[string, string]> = [
        ['UA223223130000026007233566001', 'wrong check digits (off by one)'],
        ['UA21322313000002600723356600', 'too short (28 chars)'],
        ['UA2132231300000260072335660011', 'too long (30 chars)'],
        ['UB213223130000026007233566001', 'wrong country code'],
        ['ua213223130000026007233566001', 'lowercase country code'],
        ['UA21322313000002600723356600A', 'non-digit in BBAN'],
        ['UA 213223130000026007233566001', 'leading space (length mismatch)'],
        ['UA213223130000026007233566001 ', 'trailing space (length mismatch)'],
        ['', 'empty string'],
        ['random-garbage', 'completely malformed'],
    ];

    it.each(invalidIbans)('rejects invalid IBAN %s (%s)', (iban) => {
        expect(isValidIban(iban)).toBe(false);
        expect(ibanZod.safeParse(iban).success).toBe(false);
    });

    it('rejects non-string input via the runtime guard', () => {
        expect(isValidIban(undefined as unknown as string)).toBe(false);
        expect(isValidIban(null as unknown as string)).toBe(false);
        expect(isValidIban(123 as unknown as string)).toBe(false);
    });

    it('emits the contract error code on schema rejection', () => {
        const result = ibanZod.safeParse('UA00');
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toBe('INVALID_IBAN');
        }
    });
});
