import { truncateLink } from './truncateLink';

describe('truncateLink', () => {
    it('обрізає host + 10 chars payload-у з ellipsis', () => {
        expect(
            truncateLink('https://qr.bank.gov.ua/eyJ0eXAiOiJKV1Qi')
        ).toBe('https://qr.bank.gov.ua/eyJ0eXAiOi…');
    });

    it('повертає link unchanged якщо немає slash після scheme (degenerate)', () => {
        expect(truncateLink('not-a-url')).toBe('not-a-url');
    });

    it('кастомний payloadHeadChars контролює ширину', () => {
        expect(
            truncateLink('https://qr.bank.gov.ua/abcdefghij', 3)
        ).toBe('https://qr.bank.gov.ua/abc…');
    });

    it('host-only URL (no payload) — повертає as-is без зайвого ellipsis (short-circuit guard)', () => {
        // Короткий URL без payload-у (degenerate test fixture) не повинен
        // отримувати фейкове "…", якщо обрізати немає чого.
        expect(truncateLink('https://qr.bank.gov.ua/')).toBe(
            'https://qr.bank.gov.ua/'
        );
    });

    it('URL коротший за "host + N chars" — повертає as-is (короткий-payload guard)', () => {
        // payloadHeadChars=10, link має 6 chars після слешу — обрізати нічого.
        expect(truncateLink('https://x.io/abc')).toBe('https://x.io/abc');
    });

    it('legacy NBU host (`bank.gov.ua/qr`) — береться перший слеш після scheme', () => {
        // Проста рула "indexOf('/', 8)" знаходить кінець domain-частини
        // (`bank.gov.ua`), а не "host alias" `qr`. Тобто 10 chars після
        // першого `/` включають `qr/eyJ0eXA`. UX-OK: користувач все одно
        // бачить trusted host + початок payload-у. Якщо у Sprint 9+
        // потрібна точніша обробка multi-segment host-aliases — це окремий
        // task на parser-level (`new URL(...)` + path-split).
        expect(
            truncateLink('https://bank.gov.ua/qr/eyJ0eXAiOiJKV1Qi')
        ).toBe('https://bank.gov.ua/qr/eyJ0eXA…');
    });
});
