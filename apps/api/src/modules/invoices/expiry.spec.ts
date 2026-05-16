import { isInvoiceExpired } from './expiry';

describe('isInvoiceExpired', () => {
    const NOW = new Date('2026-05-07T12:00:00.000Z').getTime();

    it('null validUntil → false (інвойс без терміну дії)', () => {
        expect(isInvoiceExpired(null, NOW)).toBe(false);
    });

    it('validUntil у майбутньому → false', () => {
        const future = new Date('2026-12-31T23:59:59.000Z');
        expect(isInvoiceExpired(future, NOW)).toBe(false);
    });

    it('validUntil у минулому → true', () => {
        const past = new Date('2026-05-01T00:00:00.000Z');
        expect(isInvoiceExpired(past, NOW)).toBe(true);
    });

    it('validUntil рівний now → false (дзеркало getInvoiceStatus: `< now` → expired)', () => {
        // Boundary: точка `validUntil === now` ще active. Перехід у "expired"
        // на наступній millisecond-tick. Узгоджено з frontend
        // `getInvoiceStatus` у `apps/web/src/entities/invoice/formatKopecks`.
        expect(isInvoiceExpired(new Date(NOW), NOW)).toBe(false);
    });

    it('validUntil на 1ms раніше за now → true', () => {
        expect(isInvoiceExpired(new Date(NOW - 1), NOW)).toBe(true);
    });
});
