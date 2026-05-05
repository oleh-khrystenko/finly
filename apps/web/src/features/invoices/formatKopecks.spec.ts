import {
    formatKopecksAsHryvnia,
    getInvoiceStatus,
} from './formatKopecks';

describe('formatKopecksAsHryvnia', () => {
    it('null → null (caller вирішує fallback)', () => {
        expect(formatKopecksAsHryvnia(null)).toBeNull();
    });

    it('150000 копійок → "1 500,00 ₴" (NBSP-thousands, comma-decimal)', () => {
        // Очікуємо UKR-формат: NBSP як thousands-separator, кома як десяткова.
        const result = formatKopecksAsHryvnia(150000);
        expect(result).toMatch(/^1\s500,00\s?₴$/);
    });

    it('100 копійок → "1,00 ₴"', () => {
        expect(formatKopecksAsHryvnia(100)).toMatch(/^1,00\s?₴$/);
    });

    it('0 копійок → "0,00 ₴"', () => {
        expect(formatKopecksAsHryvnia(0)).toMatch(/^0,00\s?₴$/);
    });

    it('1 копійка → "0,01 ₴"', () => {
        expect(formatKopecksAsHryvnia(1)).toMatch(/^0,01\s?₴$/);
    });

    it('99_999_999_999 копійок (максимум) → "999 999 999,99 ₴"', () => {
        expect(formatKopecksAsHryvnia(99_999_999_999)).toMatch(
            /^999\s999\s999,99\s?₴$/,
        );
    });
});

describe('getInvoiceStatus', () => {
    const now = new Date('2026-05-04T12:00:00.000Z');

    it('null validUntil → active', () => {
        expect(getInvoiceStatus(null, now)).toBe('active');
    });

    it('validUntil у майбутньому → active', () => {
        const future = new Date('2026-12-31T23:59:59.000Z');
        expect(getInvoiceStatus(future, now)).toBe('active');
    });

    it('validUntil у минулому → expired', () => {
        const past = new Date('2026-05-03T12:00:00.000Z');
        expect(getInvoiceStatus(past, now)).toBe('expired');
    });

    it('validUntil рівний now → active (контракт: `< now` → expired, `>= now` → active)', () => {
        // Boundary-семантика: точка `validUntil === now` трактується як "ще
        // не минув" — invoice доступний для оплати у самій останній секунді
        // свого терміну дії. Перехід у "expired" відбувається на наступній
        // millisecond-tick.
        expect(getInvoiceStatus(now, now)).toBe('active');
    });

    it('ISO-string input парситься так само як Date', () => {
        expect(getInvoiceStatus('2026-12-31T00:00:00.000Z', now)).toBe(
            'active',
        );
        expect(getInvoiceStatus('2026-04-01T00:00:00.000Z', now)).toBe(
            'expired',
        );
    });
});
