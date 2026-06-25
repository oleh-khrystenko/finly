import { Injectable, Logger } from '@nestjs/common';
import { type BillingWebhookEvent } from '@finly/types';
import { ENV } from '../../../../config/env';
import {
    ChargeByTokenInput,
    ChargeResult,
    CheckoutResult,
    IPaymentProvider,
    OneOffCheckoutInput,
    SubscriptionCheckoutInput,
    WebhookParseResult,
} from '../../interfaces/payment-provider.interface';
import {
    asRecord,
    ccyToCurrency,
    currencyToCcy,
    int,
    parseJsonObject,
    str,
    verifyWebhookSignature,
} from './monobank.signature';

const API_BASE = 'https://api.monobank.ua';
const INVOICE_CREATE = '/api/merchant/invoice/create';
const WALLET_PAYMENT = '/api/merchant/wallet/payment';
const INVOICE_STATUS = '/api/merchant/invoice/status';
const PUBKEY = '/api/merchant/pubkey';
const PAYMENT_TYPE_DEBIT = 'debit';
/** merchant-initiated: списання за токеном без присутності клієнта і без 3DS. */
const INITIATION_MERCHANT = 'merchant';
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * monobank «Плата» (Sprint 22). Тонкий виконавець без рекуренту: хостований
 * checkout із захопленням токена, разове списання за токеном, запит статусу
 * рахунку, розбір вебхука. Уся рекурентність живе у billing-clock сервісі.
 *
 * Контракт заземлено на офіційну документацію (monobank.ua/api-docs/acquiring);
 * перед фіналізацією на проді звіряється у sandbox (набір полів, формат вебхука).
 */
@Injectable()
export class MonobankService implements IPaymentProvider {
    private readonly logger = new Logger(MonobankService.name);
    private readonly token = ENV.MONOBANK_TOKEN;
    /** PEM публічного ключа для верифікації вебхуків; лінива загрузка + ротація. */
    private cachedPublicKeyPem: string | null = null;

    async createSubscriptionCheckout(
        input: SubscriptionCheckoutInput
    ): Promise<CheckoutResult> {
        const res = await this.postJson(INVOICE_CREATE, {
            amount: input.amount,
            ccy: currencyToCcy(input.currency),
            paymentType: PAYMENT_TYPE_DEBIT,
            merchantPaymInfo: {
                reference: input.orderReference,
                destination: input.planName,
            },
            redirectUrl: input.returnUrl,
            webHookUrl: input.serviceUrl,
            // Захоплення токена картки при першому реальному списанні.
            saveCardData: { saveCard: true, walletId: input.walletId },
        });
        return this.toCheckoutResult(input.orderReference, res);
    }

    async createOneOffCheckout(
        input: OneOffCheckoutInput
    ): Promise<CheckoutResult> {
        const res = await this.postJson(INVOICE_CREATE, {
            amount: input.amount,
            ccy: currencyToCcy(input.currency),
            paymentType: PAYMENT_TYPE_DEBIT,
            merchantPaymInfo: {
                reference: input.orderReference,
                destination: input.productName,
            },
            redirectUrl: input.returnUrl,
            webHookUrl: input.serviceUrl,
        });
        return this.toCheckoutResult(input.orderReference, res);
    }

    private toCheckoutResult(
        orderReference: string,
        res: Record<string, unknown>
    ): CheckoutResult {
        const invoiceId = str(res.invoiceId);
        const checkoutUrl = str(res.pageUrl);
        if (!invoiceId || !checkoutUrl) {
            throw new Error(
                `monobank invoice/create failed for ${orderReference}: ` +
                    `${str(res.errText) ?? str(res.errCode) ?? 'no invoiceId/pageUrl'}`
            );
        }
        return { checkoutUrl, invoiceId, orderReference };
    }

    async chargeByToken(input: ChargeByTokenInput): Promise<ChargeResult> {
        const res = await this.postJson(WALLET_PAYMENT, {
            cardToken: input.cardToken,
            amount: input.amount,
            ccy: currencyToCcy(input.currency),
            initiationKind: INITIATION_MERCHANT,
            paymentType: PAYMENT_TYPE_DEBIT,
            merchantPaymInfo: {
                reference: input.orderReference,
                destination: input.productName,
            },
            webHookUrl: input.serviceUrl,
        });
        const invoiceId = str(res.invoiceId);
        const status = str(res.status);
        if (!invoiceId || !status) {
            throw new Error(
                `monobank wallet/payment failed for ${input.orderReference}: ` +
                    `${str(res.errText) ?? str(res.errCode) ?? 'no invoiceId/status'}`
            );
        }
        const walletData = asRecord(res.walletData);
        const paymentInfo = asRecord(res.paymentInfo);
        return {
            invoiceId,
            status,
            cardMask: paymentInfo ? str(paymentInfo.maskedPan) : null,
            cardToken: walletData ? str(walletData.cardToken) : null,
            failureReason: str(res.failureReason),
            errCode: str(res.errCode),
        };
    }

    async getInvoiceStatus(
        invoiceId: string,
        orderReference: string
    ): Promise<BillingWebhookEvent | null> {
        const res = await this.getJson(
            `${INVOICE_STATUS}?invoiceId=${encodeURIComponent(invoiceId)}`
        );
        const status = str(res.status);
        if (!status) return null;
        return this.normalizeInvoice(res, orderReference);
    }

    async parseWebhook(
        rawBody: Buffer,
        signature: string | undefined
    ): Promise<WebhookParseResult> {
        if (!signature) {
            this.logger.warn('monobank webhook: missing X-Sign header');
            return { event: null };
        }
        const verified = await this.verifyWithRotation(rawBody, signature);
        if (!verified) {
            this.logger.warn('monobank webhook: signature mismatch');
            return { event: null };
        }
        const data = parseJsonObject(rawBody);
        if (!data) {
            this.logger.warn('monobank webhook: unparsable body');
            return { event: null };
        }
        const reference = str(data.reference);
        const status = str(data.status);
        if (!reference || !status) {
            this.logger.warn('monobank webhook: missing reference/status');
            return { event: null };
        }
        return { event: this.normalizeInvoice(data, reference) };
    }

    /**
     * Верифікує підпис; на невдачі один раз перезавантажує ключ (monobank міг
     * його ротувати) і пробує знову. Стійкий мейн-шлях без падіння на ротації.
     */
    private async verifyWithRotation(
        rawBody: Buffer,
        signature: string
    ): Promise<boolean> {
        const pem = await this.getPublicKeyPem();
        if (pem && verifyWebhookSignature(rawBody, signature, pem)) return true;
        const fresh = await this.getPublicKeyPem(true);
        if (!fresh) return false;
        return verifyWebhookSignature(rawBody, signature, fresh);
    }

    private async getPublicKeyPem(
        forceRefresh = false
    ): Promise<string | null> {
        if (this.cachedPublicKeyPem && !forceRefresh) {
            return this.cachedPublicKeyPem;
        }
        try {
            const res = await this.getJson(PUBKEY);
            const keyBase64 = str(res.key);
            if (!keyBase64) {
                this.logger.error('monobank pubkey: missing key field');
                return null;
            }
            this.cachedPublicKeyPem = Buffer.from(keyBase64, 'base64').toString(
                'utf8'
            );
            return this.cachedPublicKeyPem;
        } catch (error) {
            this.logger.error(
                'monobank pubkey fetch failed',
                error instanceof Error ? error.stack : String(error)
            );
            return null;
        }
    }

    /**
     * Нормалізує рахунок monobank (із вебхука або status-запиту) у спільну
     * `BillingWebhookEvent`. `providerEventId = invoiceId:status` дедуплікує
     * статус-переходи; джерело (push vs pull) не впливає на ідемпотентність.
     */
    private normalizeInvoice(
        data: Record<string, unknown>,
        fallbackReference: string
    ): BillingWebhookEvent {
        const invoiceId = str(data.invoiceId) ?? '';
        const status = str(data.status) ?? '';
        const walletData = asRecord(data.walletData);
        const paymentInfo = asRecord(data.paymentInfo);
        const modifiedDate = str(data.modifiedDate);
        return {
            providerEventId: `${invoiceId}:${status}`,
            orderReference: str(data.reference) ?? fallbackReference,
            invoiceId,
            occurredAt: modifiedDate ? new Date(modifiedDate) : new Date(),
            status,
            amount: int(data.finalAmount) ?? int(data.amount) ?? 0,
            currency: ccyToCurrency(int(data.ccy) ?? 0),
            cardToken: walletData ? str(walletData.cardToken) : null,
            cardMask: paymentInfo ? str(paymentInfo.maskedPan) : null,
            failureReason: str(data.failureReason),
            errCode: str(data.errCode),
            raw: data,
        };
    }

    private async postJson(
        path: string,
        body: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
        return this.request(path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Token': this.token,
            },
            body: JSON.stringify(body),
        });
    }

    private async getJson(path: string): Promise<Record<string, unknown>> {
        return this.request(path, {
            method: 'GET',
            headers: { 'X-Token': this.token },
        });
    }

    private async request(
        path: string,
        init: RequestInit
    ): Promise<Record<string, unknown>> {
        const url = `${API_BASE}${path}`;
        let res: Awaited<ReturnType<typeof fetch>>;
        try {
            res = await fetch(url, {
                ...init,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (err) {
            const reason =
                err instanceof Error && err.name === 'TimeoutError'
                    ? `timeout after ${REQUEST_TIMEOUT_MS}ms`
                    : err instanceof Error
                      ? err.message
                      : 'network error';
            throw new Error(`monobank ${path} request failed: ${reason}`);
        }
        const json: unknown = await res.json().catch(() => null);
        const record = asRecord(json) ?? {};
        if (!res.ok) {
            throw new Error(
                `monobank ${path} HTTP ${res.status}: ` +
                    `${str(record.errText) ?? str(record.errCode) ?? 'unknown'}`
            );
        }
        return record;
    }
}
