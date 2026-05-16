import { encodePayloadAsBase64Url } from './encode';

/**
 * Oracle: Buffer-based реалізація. Це reference, з якою наш isomorphic-варіант
 * повинен збігатись байт-у-байт. Buffer тут використовуємо лише в тестах (Node-only),
 * а сама функція encodePayloadAsBase64Url не залежить від Buffer.
 */
function encodeViaBuffer(payload: string): string {
    return Buffer.from(payload, 'utf-8').toString('base64url');
}

describe('encodePayloadAsBase64Url', () => {
    it('кодує порожній рядок у порожній рядок', () => {
        expect(encodePayloadAsBase64Url('')).toBe('');
    });

    it('кодує ASCII-only payload (round-trip декодером)', () => {
        const input = 'BCD\n002\n1\nUCT\n';
        const encoded = encodePayloadAsBase64Url(input);
        // Decode back via standard Base64URL → utf-8 string.
        const decoded = Buffer.from(encoded, 'base64url').toString('utf-8');
        expect(decoded).toBe(input);
    });

    it('правильно кодує українську кирилицю (UTF-8 multi-byte)', () => {
        const input = 'ФОП Іваненко';
        const encoded = encodePayloadAsBase64Url(input);
        const decoded = Buffer.from(encoded, 'base64url').toString('utf-8');
        expect(decoded).toBe(input);
    });

    it('використовує URL-safe alphabet (`-` і `_` замість `+` і `/`)', () => {
        // Підбираємо input, що дає `+` і `/` у standard Base64.
        // Рядок ?? у utf-8 → 0x3F 0x3F → у base64 = "Pz8=" — без + чи /.
        // Спробуємо рядок з cyrillic, що має байти, які дадуть і + і / у std base64.
        // 0x80 0xC4 → standard Base64 "gMQ=" — без + і /.
        // Краще генерувати тестовий рядок з усіма 256 байтами:
        const allBytes = String.fromCharCode(
            ...Array.from({ length: 256 }, (_, i) => i)
        );
        const encoded = encodePayloadAsBase64Url(allBytes);
        expect(encoded).not.toMatch(/[+/=]/);
    });

    it('видаляє padding (`=`)', () => {
        // Один байт → "AA==" в std base64 → "AA" в base64url.
        const oneByte = String.fromCharCode(0);
        const encoded = encodePayloadAsBase64Url(oneByte);
        expect(encoded).not.toMatch(/=$/);
    });

    it('детермінований: однаковий input → однаковий output', () => {
        const input = 'BCD\n003\n1\nUCT\n\nФОП Тест\n';
        const a = encodePayloadAsBase64Url(input);
        const b = encodePayloadAsBase64Url(input);
        expect(a).toBe(b);
    });

    describe('byte-for-byte parity with Buffer-based oracle', () => {
        it.each([
            ['empty', ''],
            ['ASCII single line', 'BCD'],
            ['ASCII multiline', 'BCD\n002\n1\nUCT'],
            ['cyrillic', 'ФОП Іваненко-Експрес'],
            ['mixed cyrillic + ASCII + digits', "ТОВ Кав'ярня UAH123.45"],
            ['quote characters', "«»№'"],
            ['emoji (4-byte UTF-8)', '☕️ ФОП Кафе ☕️'],
            [
                'NBU sample 002 §V.16 (стоматологія)',
                'BCD\n002\n2\nUCT\n\nТОВ "Стоматологія"\nUA7832266900000260050121073\n58\nUAH1034.28\n40723824\n\n\nСтоматологічні послуги\n',
            ],
        ])('%s', (_label, input) => {
            expect(encodePayloadAsBase64Url(input)).toBe(
                encodeViaBuffer(input)
            );
        });
    });
});
