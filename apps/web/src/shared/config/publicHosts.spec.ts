import { isPublicHost, PUBLIC_HOSTS } from './publicHosts';

describe('PUBLIC_HOSTS / isPublicHost', () => {
    it('whitelist містить prod і dev pay-host', () => {
        expect(PUBLIC_HOSTS).toEqual([
            'pay.finly.com.ua',
            'pay.finly.local:3000',
        ]);
    });

    it('isPublicHost: prod pay.finly.com.ua → true', () => {
        expect(isPublicHost('pay.finly.com.ua')).toBe(true);
    });

    it('isPublicHost: dev pay.finly.local:3000 → true', () => {
        expect(isPublicHost('pay.finly.local:3000')).toBe(true);
    });

    it('isPublicHost: cabinet finly.com.ua → false', () => {
        expect(isPublicHost('finly.com.ua')).toBe(false);
    });

    it('isPublicHost: localhost:3000 → false (cabinet dev)', () => {
        expect(isPublicHost('localhost:3000')).toBe(false);
    });

    it('isPublicHost: null/undefined/empty → false', () => {
        expect(isPublicHost(null)).toBe(false);
        expect(isPublicHost(undefined)).toBe(false);
        expect(isPublicHost('')).toBe(false);
    });

    it('isPublicHost: case-INsensitive PAY.FINLY.COM.UA → true (RFC 7230 §2.7)', () => {
        // Регресія: strict-eq comparison ламав host-isolation. Reverse-proxy
        // / curl / нестандартні клієнти можуть передавати UPPER або mixed
        // case — middleware має розпізнавати як public, інакше Branch B
        // обходиться і `/auth/signin` повертає валідну відповідь на pay-host.
        expect(isPublicHost('PAY.FINLY.COM.UA')).toBe(true);
    });

    it('isPublicHost: mixed case Pay.Finly.Com.Ua → true', () => {
        expect(isPublicHost('Pay.Finly.Com.Ua')).toBe(true);
    });

    it('isPublicHost: dev mixed case Pay.Finly.Local:3000 → true', () => {
        expect(isPublicHost('Pay.Finly.Local:3000')).toBe(true);
    });
});
