import { createHmac, timingSafeEqual } from 'crypto';
import { getKyivYmd, type BillingInterval } from '@finly/types';

/**
 * Підпис усіх WayForPay-запитів: HMAC-MD5 над конкатенацією полів через `;`
 * (UTF-8), ключ = merchantSecretKey. Помилка в ПОРЯДКУ полів ламає підпис,
 * тому побудова ізольована тут і вкрита тестами (Блок 6).
 *
 * Джерела (research-spike.md): wiki 852102 (Purchase), 852194 (Charge),
 * 852115 (Refund), 852117 (CHECK_STATUS), accept-handshake у 852102.
 */

const DELIMITER = ';';

export function signFields(secret: string, fields: string[]): string {
    return createHmac('md5', secret)
        .update(fields.join(DELIMITER), 'utf8')
        .digest('hex');
}

/** Constant-time порівняння підписів — захист від timing-атаки на вебхуці. */
export function signaturesEqual(expected: string, received: string): boolean {
    const expectedBuf = Buffer.from(expected, 'utf8');
    const receivedBuf = Buffer.from(received, 'utf8');
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
}

/**
 * Конверсія копійки→decimal-сума у валюті ("4900" → "49.00"). Домен зберігає
 * копійки-integer; WayForPay оперує decimal. Точний формат (роздільник, к-ть
 * знаків) — sandbox-уточнення; тримаємо ізольовано тут.
 */
export function kopecksToAmount(kopecks: number): string {
    return (kopecks / 100).toFixed(2);
}

/** Конверсія decimal-суми WayForPay→копійки-integer ("49.00" → 4900). */
export function amountToKopecks(amount: string | number): number {
    const value = typeof amount === 'number' ? amount : parseFloat(amount);
    return Math.round(value * 100);
}

/**
 * Підпис запиту Purchase / Charge / CREATE_INVOICE — однаковий набір і порядок:
 * merchantAccount, merchantDomainName, orderReference, orderDate, amount,
 * currency, потім ВСІ productName[], потім ВСІ productCount[], потім ВСІ
 * productPrice[] (згруповано по типу, не interleaved).
 */
export function buildPurchaseSignature(
    secret: string,
    params: {
        merchantAccount: string;
        merchantDomainName: string;
        orderReference: string;
        orderDate: number;
        amount: string;
        currency: string;
        productNames: string[];
        productCounts: number[];
        productPrices: string[];
    }
): string {
    return signFields(secret, [
        params.merchantAccount,
        params.merchantDomainName,
        params.orderReference,
        String(params.orderDate),
        params.amount,
        params.currency,
        ...params.productNames,
        ...params.productCounts.map(String),
        ...params.productPrices,
    ]);
}

/**
 * Підпис REFUND покриває лише 4 поля:
 * merchantAccount, orderReference, amount, currency.
 */
export function buildRefundSignature(
    secret: string,
    params: {
        merchantAccount: string;
        orderReference: string;
        amount: string;
        currency: string;
    }
): string {
    return signFields(secret, [
        params.merchantAccount,
        params.orderReference,
        params.amount,
        params.currency,
    ]);
}

/**
 * Підпис ВХІДНОГО вебхук-колбеку покриває 8 полів:
 * merchantAccount, orderReference, amount, currency, authCode, cardPan,
 * transactionStatus, reasonCode.
 */
export function buildWebhookSignature(
    secret: string,
    params: {
        merchantAccount: string;
        orderReference: string;
        amount: string;
        currency: string;
        authCode: string;
        cardPan: string;
        transactionStatus: string;
        reasonCode: string;
    }
): string {
    return signFields(secret, [
        params.merchantAccount,
        params.orderReference,
        params.amount,
        params.currency,
        params.authCode,
        params.cardPan,
        params.transactionStatus,
        params.reasonCode,
    ]);
}

/**
 * Підпис нашої accept-відповіді покриває 3 поля:
 * orderReference, status, time. БЕЗ цієї відповіді WayForPay шле повтори.
 */
export function buildAcceptSignature(
    secret: string,
    params: { orderReference: string; status: string; time: number }
): string {
    return signFields(secret, [
        params.orderReference,
        params.status,
        String(params.time),
    ]);
}

/** Інтервал підписки → WayForPay regularMode. */
export function intervalToRegularMode(interval: BillingInterval): string {
    return interval === 'year' ? 'yearly' : 'monthly';
}

/**
 * WayForPay regular-дати у форматі DD.MM.YYYY. Норматив трактує regular-дати як
 * локальний український час, тож календарний день беремо у `Europe/Kyiv` (не
 * UTC і не server-local) — інакше instant біля межі доби зсувається на день.
 */
export function formatRegularDate(date: Date): string {
    const { year, month, day } = getKyivYmd(date);
    const dd = String(day).padStart(2, '0');
    const mm = String(month).padStart(2, '0');
    return `${dd}.${mm}.${year}`;
}
