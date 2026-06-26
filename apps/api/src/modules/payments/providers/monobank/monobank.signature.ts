import { createVerify } from 'crypto';
import { BILLING_CURRENCY } from '@finly/types';

/** ISO 4217 numeric для гривні — monobank оперує `ccy`-кодом, не літерами. */
export const CCY_UAH = 980;

/**
 * monobank приймає/повертає суму у мінорних одиницях (копійки) — збігається з
 * нашим доменним інваріантом, тож конверсії немає (на відміну від WayForPay
 * decimal). Хелпери лишаються точкою істини на випадок зміни.
 */
export function currencyToCcy(currency: string): number {
    if (currency === BILLING_CURRENCY) return CCY_UAH;
    throw new Error(`Unsupported billing currency: ${currency}`);
}

export function ccyToCurrency(ccy: number): string {
    return ccy === CCY_UAH ? BILLING_CURRENCY : String(ccy);
}

/**
 * Верифікація підпису вебхука monobank: заголовок `X-Sign` — base64 ECDSA-SHA256
 * (ASN.1 DER) над СИРИМ тілом запиту. Публічний ключ — PEM, отриманий з
 * `GET /api/merchant/pubkey` (там він base64-кодований; декодування робить
 * сервіс перед передачею сюди). Будь-який збій крипто-перевірки → false (не throw),
 * щоб контролер віддав нейтральну відповідь без витоку причини.
 */
export function verifyWebhookSignature(
    rawBody: Buffer,
    signatureBase64: string,
    publicKeyPem: string
): boolean {
    try {
        const verifier = createVerify('SHA256');
        verifier.update(rawBody);
        verifier.end();
        return verifier.verify(
            publicKeyPem,
            Buffer.from(signatureBase64, 'base64')
        );
    } catch {
        return false;
    }
}

export function parseJsonObject(
    rawBody: Buffer
): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
        return typeof parsed === 'object' &&
            parsed !== null &&
            !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

export function str(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

export function int(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value))
        return Math.trunc(value);
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
}
