import { formatKopecksForInput, parseUaMoney } from './money';

describe('parseUaMoney', () => {
    it('empty / whitespace → null (signage-mode)', () => {
        expect(parseUaMoney('')).toEqual({ ok: true, kopecks: null });
        expect(parseUaMoney('   ')).toEqual({ ok: true, kopecks: null });
        expect(parseUaMoney(' ')).toEqual({ ok: true, kopecks: null });
    });

    it('UA-кома як decimal separator: 1500,50 → 150050 копійок', () => {
        expect(parseUaMoney('1500,50')).toEqual({
            ok: true,
            kopecks: 150050,
        });
    });

    it('крапка теж приймається: 1500.50 → 150050 копійок', () => {
        expect(parseUaMoney('1500.50')).toEqual({
            ok: true,
            kopecks: 150050,
        });
    });

    it('integer-only: 1500 → 150000 копійок', () => {
        expect(parseUaMoney('1500')).toEqual({ ok: true, kopecks: 150000 });
    });

    it('one-decimal: 1500,5 → 150050 копійок (pad до 2-х)', () => {
        expect(parseUaMoney('1500,5')).toEqual({ ok: true, kopecks: 150050 });
    });

    it('zero amount valid: 0 → 0; 0,00 → 0', () => {
        expect(parseUaMoney('0')).toEqual({ ok: true, kopecks: 0 });
        expect(parseUaMoney('0,00')).toEqual({ ok: true, kopecks: 0 });
    });

    it('strip NBSP/space (paste з formatted-displaying)', () => {
        // Intl uk-UA NBSP як thousands; "1 500,50 ₴" — типовий paste-source.
        expect(parseUaMoney('1 500,50')).toEqual({
            ok: true,
            kopecks: 150050,
        });
        expect(parseUaMoney('1 500,50 ₴')).toEqual({
            ok: true,
            kopecks: 150050,
        });
    });

    it('two separators → INVALID_AMOUNT_FORMAT (european 1.500,50 ambiguous)', () => {
        expect(parseUaMoney('1.500,50')).toEqual({
            ok: false,
            error: 'INVALID_AMOUNT_FORMAT',
        });
    });

    it('letters / non-numeric → INVALID_AMOUNT_FORMAT', () => {
        expect(parseUaMoney('abc')).toEqual({
            ok: false,
            error: 'INVALID_AMOUNT_FORMAT',
        });
        expect(parseUaMoney('1500abc')).toEqual({
            ok: false,
            error: 'INVALID_AMOUNT_FORMAT',
        });
    });

    it('3+ decimals → INVALID_AMOUNT_PRECISION', () => {
        expect(parseUaMoney('1500,505')).toEqual({
            ok: false,
            error: 'INVALID_AMOUNT_PRECISION',
        });
    });

    it('negative → INVALID_AMOUNT_NEGATIVE', () => {
        expect(parseUaMoney('-1500')).toEqual({
            ok: false,
            error: 'INVALID_AMOUNT_NEGATIVE',
        });
        expect(parseUaMoney('-1500,50')).toEqual({
            ok: false,
            error: 'INVALID_AMOUNT_NEGATIVE',
        });
    });
});

describe('formatKopecksForInput', () => {
    it('null → empty string (signage)', () => {
        expect(formatKopecksForInput(null)).toBe('');
    });

    it('150050 копійок → "1500,50"', () => {
        expect(formatKopecksForInput(150050)).toBe('1500,50');
    });

    it('0 → "0,00"', () => {
        expect(formatKopecksForInput(0)).toBe('0,00');
    });

    it('1 копійка → "0,01"', () => {
        expect(formatKopecksForInput(1)).toBe('0,01');
    });

    it('150000 (рівно гривні) → "1500,00"', () => {
        expect(formatKopecksForInput(150000)).toBe('1500,00');
    });

    it('round-trip: format → parse → format', () => {
        const cases = [0, 1, 50, 100, 12345, 99_999_999_999];
        for (const k of cases) {
            const formatted = formatKopecksForInput(k);
            const parsed = parseUaMoney(formatted);
            expect(parsed).toEqual({ ok: true, kopecks: k });
        }
    });
});
