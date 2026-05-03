import { PayloadValidationError } from './errors';
import { buildNbuPayloadLink } from './universal-link';

const SAMPLE_B64 = 'QkNECjAwMwoyClVDV';

describe('buildNbuPayloadLink — version 002', () => {
    it('використовує hardcoded normative prefix bank.gov.ua/qr/', () => {
        expect(buildNbuPayloadLink('002', SAMPLE_B64)).toBe(
            `https://bank.gov.ua/qr/${SAMPLE_B64}`
        );
    });

    it('ігнорує host для 002 (норматив фіксує fixed prefix)', () => {
        const a = buildNbuPayloadLink('002', SAMPLE_B64);
        const b = buildNbuPayloadLink('002', SAMPLE_B64, {
            host: 'qr.bank.gov.ua',
        });
        expect(a).toBe(b);
    });

    it('конкатенація без додаткового розділювача (Додаток 3 §I.2.1)', () => {
        const link = buildNbuPayloadLink('002', SAMPLE_B64);
        expect(link).not.toContain('//' + SAMPLE_B64);
        expect(link.endsWith(`/${SAMPLE_B64}`)).toBe(true);
    });
});

describe('buildNbuPayloadLink — version 003', () => {
    it('використовує переданий host (default normative — qr.bank.gov.ua)', () => {
        expect(
            buildNbuPayloadLink('003', SAMPLE_B64, {
                host: 'qr.bank.gov.ua',
            })
        ).toBe(`https://qr.bank.gov.ua/${SAMPLE_B64}`);
    });

    it('приймає fallback host bank.gov.ua/qr (per QR-6 deviation)', () => {
        expect(
            buildNbuPayloadLink('003', SAMPLE_B64, {
                host: 'bank.gov.ua/qr',
            })
        ).toBe(`https://bank.gov.ua/qr/${SAMPLE_B64}`);
    });

    it('кидає PAYLOAD_HOST_REQUIRED, якщо host не передано', () => {
        expect(() => buildNbuPayloadLink('003', SAMPLE_B64)).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_HOST_REQUIRED',
                field: 'host',
                version: '003',
            })
        );
    });

    it('кидає PAYLOAD_NON_COMPLIANT_HOST для host поза whitelist', () => {
        expect(() =>
            buildNbuPayloadLink('003', SAMPLE_B64, {
                host: 'pay.finly.com.ua',
            })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_NON_COMPLIANT_HOST',
                field: 'host',
                version: '003',
            })
        );
    });

    it('відхиляє host з протоколом (повний URL замість host-частини)', () => {
        expect(() =>
            buildNbuPayloadLink('003', SAMPLE_B64, {
                host: 'https://qr.bank.gov.ua',
            })
        ).toThrow(PayloadValidationError);
    });

    it('відхиляє порожній host', () => {
        expect(() =>
            buildNbuPayloadLink('003', SAMPLE_B64, { host: '' })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_HOST_REQUIRED',
            })
        );
    });
});

describe('buildNbuPayloadLink — детермінованість', () => {
    it('однаковий input → однаковий output', () => {
        const a = buildNbuPayloadLink('003', SAMPLE_B64, {
            host: 'qr.bank.gov.ua',
        });
        const b = buildNbuPayloadLink('003', SAMPLE_B64, {
            host: 'qr.bank.gov.ua',
        });
        expect(a).toBe(b);
    });
});

describe('buildNbuPayloadLink — Base64URL frame ≤ 475 B (норматив таблиця 1)', () => {
    it('приймає b64url рівно на межі (475 chars)', () => {
        const onLimit = 'A'.repeat(475);
        expect(() => buildNbuPayloadLink('002', onLimit)).not.toThrow();
    });

    it('відхиляє b64url довжиною 476 для 002', () => {
        const overflow = 'A'.repeat(476);
        expect(() => buildNbuPayloadLink('002', overflow)).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_BASE64URL_SIZE_EXCEEDED',
                field: 'base64UrlPayload',
                version: '002',
            })
        );
    });

    it('відхиляє b64url довжиною 476 для 003', () => {
        const overflow = 'A'.repeat(476);
        expect(() =>
            buildNbuPayloadLink('003', overflow, {
                host: 'qr.bank.gov.ua',
            })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_BASE64URL_SIZE_EXCEEDED',
                version: '003',
            })
        );
    });

    it('перевіряє b64url ДО host-валідації (b64url overflow важливіший за host typo)', () => {
        // Якщо b64url overflow + host invalid → отримуємо помилку про b64url, не host.
        const overflow = 'A'.repeat(500);
        expect(() =>
            buildNbuPayloadLink('003', overflow, {
                host: 'pay.finly.com.ua',
            })
        ).toThrow(
            expect.objectContaining({
                code: 'PAYLOAD_BASE64URL_SIZE_EXCEEDED',
            })
        );
    });
});
