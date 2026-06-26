import { createSign, generateKeyPairSync } from 'crypto';
import {
    CCY_UAH,
    ccyToCurrency,
    currencyToCcy,
    int,
    parseJsonObject,
    str,
    verifyWebhookSignature,
} from './monobank.signature';

describe('monobank.signature — ccy mapping', () => {
    it('UAH ↔ 980', () => {
        expect(currencyToCcy('UAH')).toBe(CCY_UAH);
        expect(ccyToCurrency(980)).toBe('UAH');
    });

    it('невідома валюта на вихід кидає', () => {
        expect(() => currencyToCcy('USD')).toThrow();
    });

    it('невідомий ccy на вхід повертає рядок коду', () => {
        expect(ccyToCurrency(840)).toBe('840');
    });
});

describe('monobank.signature — parse helpers', () => {
    it('parseJsonObject повертає обʼєкт, null на сміттю/масиві', () => {
        expect(parseJsonObject(Buffer.from('{"a":1}'))).toEqual({ a: 1 });
        expect(parseJsonObject(Buffer.from('[1,2]'))).toBeNull();
        expect(parseJsonObject(Buffer.from('not json'))).toBeNull();
    });

    it('str / int нормалізують', () => {
        expect(str('x')).toBe('x');
        expect(str('')).toBeNull();
        expect(str(5)).toBeNull();
        expect(int(4200)).toBe(4200);
        expect(int('4200')).toBe(4200);
        expect(int('x')).toBeNull();
    });
});

describe('monobank.signature — ECDSA webhook verification', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
    });
    const publicKeyPem = publicKey.export({
        type: 'spki',
        format: 'pem',
    }) as string;

    function sign(body: Buffer): string {
        const signer = createSign('SHA256');
        signer.update(body);
        signer.end();
        return signer.sign(privateKey).toString('base64');
    }

    it('валідний підпис над сирим тілом → true', () => {
        const body = Buffer.from('{"invoiceId":"p1","status":"success"}');
        expect(verifyWebhookSignature(body, sign(body), publicKeyPem)).toBe(
            true
        );
    });

    it('підмінене тіло → false', () => {
        const body = Buffer.from('{"invoiceId":"p1","status":"success"}');
        const tampered = Buffer.from('{"invoiceId":"p1","status":"failure"}');
        expect(verifyWebhookSignature(tampered, sign(body), publicKeyPem)).toBe(
            false
        );
    });

    it('сміття замість підпису → false (без throw)', () => {
        const body = Buffer.from('{}');
        expect(
            verifyWebhookSignature(body, 'not-base64-sig', publicKeyPem)
        ).toBe(false);
    });
});
