import { Injectable, Logger } from '@nestjs/common';
import {
    WAYFORPAY_TRANSACTION_STATUS,
    type BillingWebhookEvent,
} from '@finly/types';
import { ENV } from '../../../../config/env';
import {
    CheckoutResult,
    ChargeInput,
    ChargeResult,
    IPaymentProvider,
    OneOffCheckoutInput,
    RefundInput,
    RefundResult,
    SubscriptionChange,
    SubscriptionCheckoutInput,
    SubscriptionStatusResult,
    WebhookParseResult,
} from '../../interfaces/payment-provider.interface';
import {
    amountToKopecks,
    buildAcceptSignature,
    buildPurchaseSignature,
    buildRefundSignature,
    buildWebhookSignature,
    formatRegularDate,
    intervalToRegularMode,
    kopecksToAmount,
    signaturesEqual,
} from './wayforpay.signature';

const API_URL = 'https://api.wayforpay.com/api';
const REGULAR_API_URL = 'https://api.wayforpay.com/regularApi';
const API_VERSION = 1;
const MERCHANT_AUTH_TYPE = 'SimpleSignature';
/** reasonCode успіху для regularApi-операцій (wiki 852526 та ін.). */
const REGULAR_OK_CODE = 4100;
/** Стеля очікування відповіді WayForPay — виклики живуть у request-path юзера. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * WayForPay-провайдер білінгу (Sprint 17). Гібрид: розклад веде провайдер
 * (Regular payments), recToken тримаємо для ad-hoc Charge (proration-доплата).
 *
 * Два транспорти:
 *  - `/api` (CREATE_INVOICE / CHARGE / REFUND) — camelCase, підпис HMAC-MD5.
 *  - `/regularApi` (STATUS/SUSPEND/RESUME/REMOVE/CHANGE) — автентифікація через
 *    merchantPassword, без HMAC.
 *
 * Sandbox-локалізовані невідомі (кожне ізольоване, не stub): точний формат суми
 * (`wayforpay.signature.ts`), захоплення recToken (поле `recToken` колбеку у
 * `parseWebhook`), деферал trial (`dateNext` у checkout).
 */
@Injectable()
export class WayForPayService implements IPaymentProvider {
    private readonly logger = new Logger(WayForPayService.name);
    private readonly merchantAccount = ENV.WAYFORPAY_MERCHANT_ACCOUNT;
    private readonly merchantDomain = ENV.WAYFORPAY_MERCHANT_DOMAIN;
    private readonly secret = ENV.WAYFORPAY_MERCHANT_SECRET_KEY;

    async createSubscriptionCheckout(
        input: SubscriptionCheckoutInput
    ): Promise<CheckoutResult> {
        const regularFields: Record<string, unknown> = {
            regularBehavior: 'preset',
            regularMode: intervalToRegularMode(input.interval),
        };
        // Відкладене перше списання (trial або re-bind картки) через dateNext.
        if (input.firstChargeDate) {
            regularFields.dateNext = formatRegularDate(input.firstChargeDate);
        }
        return this.createInvoice(input, input.planName, regularFields);
    }

    async createOneOffCheckout(
        input: OneOffCheckoutInput
    ): Promise<CheckoutResult> {
        return this.createInvoice(input, input.packName, {});
    }

    private async createInvoice(
        input: {
            orderReference: string;
            userEmail: string;
            amount: number;
            currency: string;
            serviceUrl: string;
            returnUrl: string;
        },
        productName: string,
        regularFields: Record<string, unknown>
    ): Promise<CheckoutResult> {
        const orderDate = unixNow();
        const amount = kopecksToAmount(input.amount);
        const signature = buildPurchaseSignature(this.secret, {
            merchantAccount: this.merchantAccount,
            merchantDomainName: this.merchantDomain,
            orderReference: input.orderReference,
            orderDate,
            amount,
            currency: input.currency,
            productNames: [productName],
            productCounts: [1],
            productPrices: [amount],
        });

        const body = {
            transactionType: 'CREATE_INVOICE',
            merchantAccount: this.merchantAccount,
            merchantAuthType: MERCHANT_AUTH_TYPE,
            merchantDomainName: this.merchantDomain,
            merchantSignature: signature,
            apiVersion: API_VERSION,
            language: 'UA',
            serviceUrl: input.serviceUrl,
            returnUrl: input.returnUrl,
            orderReference: input.orderReference,
            orderDate,
            amount,
            currency: input.currency,
            productName: [productName],
            productPrice: [amount],
            productCount: [1],
            clientEmail: input.userEmail,
            ...regularFields,
        };

        const res = await this.postJson(API_URL, body);
        const invoiceUrl = str(res.invoiceUrl);
        if (!invoiceUrl) {
            throw new Error(
                `WayForPay CREATE_INVOICE failed for ${input.orderReference}: ` +
                    `${str(res.reason) ?? 'no invoiceUrl'} (code ${num(res.reasonCode) ?? '?'})`
            );
        }
        return {
            checkoutUrl: invoiceUrl,
            orderReference: input.orderReference,
        };
    }

    async chargeByToken(input: ChargeInput): Promise<ChargeResult> {
        const orderDate = unixNow();
        const amount = kopecksToAmount(input.amount);
        const signature = buildPurchaseSignature(this.secret, {
            merchantAccount: this.merchantAccount,
            merchantDomainName: this.merchantDomain,
            orderReference: input.orderReference,
            orderDate,
            amount,
            currency: input.currency,
            productNames: [input.description],
            productCounts: [1],
            productPrices: [amount],
        });

        const body = {
            transactionType: 'CHARGE',
            merchantAccount: this.merchantAccount,
            merchantAuthType: MERCHANT_AUTH_TYPE,
            merchantDomainName: this.merchantDomain,
            merchantSignature: signature,
            apiVersion: API_VERSION,
            orderReference: input.orderReference,
            orderDate,
            amount,
            currency: input.currency,
            productName: [input.description],
            productPrice: [amount],
            productCount: [1],
            recToken: input.recToken,
        };

        const res = await this.postJson(API_URL, body);
        const transactionStatus = str(res.transactionStatus);
        return {
            success:
                transactionStatus === WAYFORPAY_TRANSACTION_STATUS.APPROVED,
            transactionId: rawScalar(res.transactionId) || null,
            cardMask: str(res.cardPan) ?? null,
            reasonCode: num(res.reasonCode),
            reason: str(res.reason) ?? null,
        };
    }

    async refund(input: RefundInput): Promise<RefundResult> {
        const amount = kopecksToAmount(input.amount);
        const signature = buildRefundSignature(this.secret, {
            merchantAccount: this.merchantAccount,
            orderReference: input.orderReference,
            amount,
            currency: input.currency,
        });

        const body = {
            transactionType: 'REFUND',
            merchantAccount: this.merchantAccount,
            orderReference: input.orderReference,
            amount,
            currency: input.currency,
            comment: input.comment,
            merchantSignature: signature,
            apiVersion: API_VERSION,
        };

        const res = await this.postJson(API_URL, body);
        const transactionStatus = str(res.transactionStatus);
        return {
            success:
                transactionStatus === WAYFORPAY_TRANSACTION_STATUS.REFUNDED ||
                transactionStatus === WAYFORPAY_TRANSACTION_STATUS.VOIDED,
            reasonCode: num(res.reasonCode),
            reason: str(res.reason) ?? null,
        };
    }

    async getSubscriptionStatus(
        orderReference: string
    ): Promise<SubscriptionStatusResult> {
        const res = await this.regularRequest('STATUS', orderReference, {}, true);
        return {
            status: str(res.status) ?? 'Unknown',
            nextPaymentDate: parseRegularDate(str(res.nextPaymentDate)),
            lastPayedDate: parseRegularDate(str(res.lastPayedDate)),
            dateEnd: parseRegularDate(str(res.dateEnd)),
        };
    }

    async suspendSubscription(orderReference: string): Promise<void> {
        await this.regularRequest('SUSPEND', orderReference, {}, true);
    }

    async resumeSubscription(orderReference: string): Promise<void> {
        await this.regularRequest('RESUME', orderReference, {}, true);
    }

    async removeSubscription(orderReference: string): Promise<void> {
        await this.regularRequest('REMOVE', orderReference, {}, true);
    }

    async changeSubscription(
        orderReference: string,
        change: SubscriptionChange
    ): Promise<void> {
        const extra: Record<string, unknown> = {};
        if (change.amount != null) extra.amount = kopecksToAmount(change.amount);
        if (change.currency) extra.currency = change.currency;
        if (change.interval)
            extra.regularMode = intervalToRegularMode(change.interval);
        if (change.nextPaymentDate)
            extra.dateBegin = formatRegularDate(change.nextPaymentDate);
        if (change.endDate) extra.dateEnd = formatRegularDate(change.endDate);
        await this.regularRequest('CHANGE', orderReference, extra, true);
    }

    private async regularRequest(
        requestType: string,
        orderReference: string,
        extra: Record<string, unknown>,
        assertOk = false
    ): Promise<Record<string, unknown>> {
        const body = {
            requestType,
            merchantAccount: this.merchantAccount,
            merchantPassword: this.secret,
            orderReference,
            ...extra,
        };
        const res = await this.postJson(REGULAR_API_URL, body);
        if (assertOk) {
            const code = num(res.reasonCode);
            if (code !== REGULAR_OK_CODE) {
                throw new Error(
                    `WayForPay ${requestType} failed for ${orderReference}: ` +
                        `${str(res.reason) ?? 'unknown'} (code ${code ?? '?'})`
                );
            }
        }
        return res;
    }

    async parseWebhook(rawBody: Buffer): Promise<WebhookParseResult> {
        const data = parseCallbackBody(rawBody);
        if (!data) {
            this.logger.warn('WayForPay webhook: unparsable body');
            return { event: null, acceptResponse: null };
        }

        const orderReference = str(data.orderReference);
        const transactionStatus = str(data.transactionStatus);
        const merchantSignature = str(data.merchantSignature);
        if (!orderReference || !transactionStatus || !merchantSignature) {
            this.logger.warn('WayForPay webhook: missing required fields');
            return { event: null, acceptResponse: null };
        }

        const expected = buildWebhookSignature(this.secret, {
            merchantAccount: str(data.merchantAccount) ?? '',
            orderReference,
            amount: rawScalar(data.amount),
            currency: str(data.currency) ?? '',
            authCode: rawScalar(data.authCode),
            cardPan: str(data.cardPan) ?? '',
            transactionStatus,
            reasonCode: rawScalar(data.reasonCode),
        });
        if (!signaturesEqual(expected, merchantSignature)) {
            this.logger.warn(
                `WayForPay webhook: signature mismatch for ${orderReference}`
            );
            return { event: null, acceptResponse: null };
        }

        const occurredAt = num(data.processingDate)
            ? new Date(num(data.processingDate)! * 1000)
            : new Date();

        // Ключ дедуплікації = transactionId + статус. Один transactionId
        // проходить кілька статус-переходів (InProcessing → Approved) з тим
        // самим orderReference; без статусу в ключі фінальний Approved відкинувся
        // б як дубль проміжного колбеку — користувача списали б, але не
        // зарахували. Повтори того самого (transactionId, status) дедуплікуються
        // коректно. Fallback (рідкі колбеки без transactionId) лишаємо
        // payload-детермінованим — processingDate не змінюється між повторами.
        const transactionId = rawScalar(data.transactionId) || null;
        const providerEventId = transactionId
            ? `txn:${transactionId}:${transactionStatus}`
            : `${orderReference}:${transactionStatus}:${rawScalar(data.processingDate)}`;

        const event: BillingWebhookEvent = {
            providerEventId,
            orderReference,
            occurredAt,
            transactionStatus,
            amount: amountToKopecks(rawScalar(data.amount)),
            currency: str(data.currency) ?? '',
            transactionId,
            cardMask: str(data.cardPan) ?? null,
            recToken: str(data.recToken) || null,
            reasonCode: num(data.reasonCode),
            raw: data,
        };

        return {
            event,
            acceptResponse: this.buildAccept(orderReference),
        };
    }

    private buildAccept(orderReference: string): Record<string, unknown> {
        const time = unixNow();
        const status = 'accept';
        const signature = buildAcceptSignature(this.secret, {
            orderReference,
            status,
            time,
        });
        return { orderReference, status, time, signature };
    }

    private async postJson(
        url: string,
        body: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
        let res: Awaited<ReturnType<typeof fetch>>;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (err) {
            const reason =
                err instanceof Error && err.name === 'TimeoutError'
                    ? `timeout after ${REQUEST_TIMEOUT_MS}ms`
                    : err instanceof Error
                      ? err.message
                      : 'network error';
            throw new Error(`WayForPay ${url} request failed: ${reason}`);
        }
        if (!res.ok) {
            throw new Error(`WayForPay ${url} HTTP ${res.status}`);
        }
        const json: unknown = await res.json();
        return asRecord(json) ?? {};
    }
}

// --- Pure helpers ---

function unixNow(): number {
    return Math.floor(Date.now() / 1000);
}

/**
 * WayForPay regular-дати (`DD.MM.YYYY`) — локальний український день. Anchor
 * 12:00 UTC (як `addMonths`/`formatRegularDate`) тримає instant у межах того ж
 * Kyiv-дня, тож `getKyivYmd(parseRegularDate(x))` round-тріпить день назад. UTC
 * опівніч зсувала б дату на день назад для споживачів Kyiv-семантики.
 */
function parseRegularDate(value: string | undefined): Date | null {
    if (!value) return null;
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
    if (!match) return null;
    const [, dd, mm, yyyy] = match;
    return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), 12));
}

/**
 * WayForPay serviceUrl-колбек приходить як JSON-тіло або як form-urlencoded,
 * де JSON є ключем єдиної пари (`<json>=`) або значенням (`key=<json>`).
 * Пробуємо обидві сторони кожної пари і повертаємо першу, що парситься як JSON.
 */
function parseCallbackBody(rawBody: Buffer): Record<string, unknown> | null {
    const text = rawBody.toString('utf8').trim();
    if (!text) return null;

    const direct = tryParseJson(text);
    if (direct) return direct;

    for (const pair of text.split('&')) {
        const eqIndex = pair.indexOf('=');
        const sides =
            eqIndex >= 0
                ? [pair.slice(0, eqIndex), pair.slice(eqIndex + 1)]
                : [pair];
        for (const side of sides) {
            const decoded = urlDecode(side);
            const parsed = decoded ? tryParseJson(decoded) : null;
            if (parsed) return parsed;
        }
    }
    return null;
}

function urlDecode(text: string): string | null {
    if (!text) return null;
    try {
        return decodeURIComponent(text.replace(/\+/g, ' '));
    } catch {
        return null;
    }
}

function tryParseJson(text: string): Record<string, unknown> | null {
    try {
        return asRecord(JSON.parse(text));
    } catch {
        return null;
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function str(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

/** Скалярне значення як рядок для підпису (зберігає те, що прислав WayForPay). */
function rawScalar(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    return '';
}
