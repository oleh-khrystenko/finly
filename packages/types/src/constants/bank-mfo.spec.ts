import { BANK_MFO_MAP, bankCodeFromIban } from './bank-mfo';
import { MVP_BANKS } from './banks';

describe('BANK_MFO_MAP', () => {
    it('містить запис для кожного банку з MVP_BANKS (10 entries)', () => {
        const mappedBankCodes = new Set(Object.values(BANK_MFO_MAP));
        for (const bankCode of MVP_BANKS) {
            expect(mappedBankCodes.has(bankCode)).toBe(true);
        }
        expect(mappedBankCodes.size).toBe(MVP_BANKS.length);
    });

    it('усі МФО — 6-цифрові рядки', () => {
        for (const mfo of Object.keys(BANK_MFO_MAP)) {
            expect(mfo).toMatch(/^\d{6}$/);
        }
    });

    it('МФО унікальні (немає двох банків з однаковим МФО)', () => {
        const mfoSet = new Set(Object.keys(BANK_MFO_MAP));
        expect(mfoSet.size).toBe(Object.keys(BANK_MFO_MAP).length);
    });

    it('BankCode-значення унікальні (не подвоюється один банк на 2 МФО)', () => {
        const bankCodes = Object.values(BANK_MFO_MAP);
        expect(new Set(bankCodes).size).toBe(bankCodes.length);
    });
});

describe('bankCodeFromIban', () => {
    // Конструюємо валідно-формат-овий UA IBAN з конкретним МФО на позиціях 5-10
    // (1-indexed). Checksum-цифри `21` тут не валідні структурно — це OK, бо
    // `bankCodeFromIban` не робить checksum-перевірки (це job `ibanZod`).
    const ibanWithMfo = (mfo: string): string => `UA21${mfo}0000026007233566001`;

    it.each(Object.entries(BANK_MFO_MAP))(
        'резолвить МФО %s → %s',
        (mfo, expectedBankCode) => {
            const result = bankCodeFromIban(ibanWithMfo(mfo));
            expect(result).toBe(expectedBankCode);
        }
    );

    it('повертає null на невідомий МФО (банк поза BANK_MFO_MAP)', () => {
        const result = bankCodeFromIban(ibanWithMfo('999999'));
        expect(result).toBeNull();
    });

    it('повертає null на не-UA IBAN', () => {
        const result = bankCodeFromIban('DE89370400440532013000');
        expect(result).toBeNull();
    });

    it('повертає null на занадто короткий рядок', () => {
        const result = bankCodeFromIban('UA21305');
        expect(result).toBeNull();
    });

    it('повертає null на пустий рядок', () => {
        const result = bankCodeFromIban('');
        expect(result).toBeNull();
    });

    it('повертає null на non-digit МФО-сегмент (corrupt input)', () => {
        const result = bankCodeFromIban('UA21abcdef0000026007233566001');
        expect(result).toBeNull();
    });

    it('игнорує checksum (не валідує IBAN-checksum, тільки extract МФО)', () => {
        // `UA00305299...` — checksum-цифри 00 структурно невалідні (mod-97
        // не дасть 1), але `bankCodeFromIban` extract-ить 305299 → privatbank.
        // Checksum-валідація живе у `ibanZod` (write-DTO); helper суто parses.
        const result = bankCodeFromIban('UA003052990000026007233566001');
        expect(result).toBe('privatbank');
    });

    it('Sprint 9 §SP-9 VERIFIED — privatbank 305299', () => {
        // Snapshot test для VERIFIED-запису. Якщо PR-review зміняє інший
        // МФО, цей тест продовжує захищати фіксований verified value.
        expect(BANK_MFO_MAP['305299']).toBe('privatbank');
    });

    it('Sprint 9 §SP-9 VERIFIED — oschadbank 300465', () => {
        expect(BANK_MFO_MAP['300465']).toBe('oschadbank');
    });
});
