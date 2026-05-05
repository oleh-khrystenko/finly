import { effectiveInvoicePurpose } from './purpose-resolver';

describe('effectiveInvoicePurpose', () => {
    it('returns invoice purpose коли non-null', () => {
        expect(effectiveInvoicePurpose('Custom invoice', 'Default biz')).toBe(
            'Custom invoice'
        );
    });

    it('returns business template коли invoice purpose === null', () => {
        expect(effectiveInvoicePurpose(null, 'Default biz')).toBe(
            'Default biz'
        );
    });

    it('passthrough empty string (caller-validated invariant)', () => {
        // Sprint 1 entity-Zod не дозволить empty на write, але pure helper
        // за контрактом: будь-який non-null string повертається сирим.
        // Цей тест фіксує контракт, не дрейфує у "auto-fallback на template
        // для пустих рядків" — це поза сферою resolver-а.
        expect(effectiveInvoicePurpose('', 'Default biz')).toBe('');
    });

    it('passthrough whitespace-only', () => {
        expect(effectiveInvoicePurpose('   ', 'Default biz')).toBe('   ');
    });

    it('повертає cyrillic input as-is', () => {
        expect(
            effectiveInvoicePurpose('Оплата за консультацію', 'Default')
        ).toBe('Оплата за консультацію');
    });

    it('preserves emoji у inheritance-bottom (business template)', () => {
        expect(effectiveInvoicePurpose(null, 'Послуги 🚀')).toBe('Послуги 🚀');
    });
});
