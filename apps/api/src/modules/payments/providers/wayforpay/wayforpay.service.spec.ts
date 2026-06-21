import { WayForPayService } from './wayforpay.service';
import {
    buildAcceptSignature,
    buildWebhookSignature,
} from './wayforpay.signature';

const SECRET = 'flk3409refn54t54t*FNJRET';
const MERCHANT = 'test_merch_n1';

function signedCallback(
    overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
    const base: Record<string, unknown> = {
        merchantAccount: MERCHANT,
        orderReference: 'fin-pack-max-507f1f77bcf86cd799439011-abc',
        amount: 99.0,
        currency: 'UAH',
        authCode: '123456',
        cardPan: '44****1111',
        transactionStatus: 'Approved',
        reasonCode: 1100,
        processingDate: 1_700_000_000,
        ...overrides,
    };
    base.merchantSignature = buildWebhookSignature(SECRET, {
        merchantAccount: String(base.merchantAccount),
        orderReference: String(base.orderReference),
        amount: String(base.amount),
        currency: String(base.currency),
        authCode: String(base.authCode),
        cardPan: String(base.cardPan),
        transactionStatus: String(base.transactionStatus),
        reasonCode: String(base.reasonCode),
    });
    return base;
}

function mockFetchOnce(json: Record<string, unknown>, ok = true): jest.Mock {
    const fetchMock = jest.fn().mockResolvedValue({
        ok,
        status: ok ? 200 : 500,
        json: () => Promise.resolve(json),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
}

describe('WayForPayService', () => {
    let service: WayForPayService;

    beforeEach(() => {
        service = new WayForPayService();
    });

    describe('parseWebhook', () => {
        it('валідний підпис → нормалізована подія + accept', async () => {
            const body = signedCallback({ recToken: 'tok_123' });
            const result = await service.parseWebhook(
                Buffer.from(JSON.stringify(body))
            );

            expect(result.event).not.toBeNull();
            expect(result.event).toMatchObject({
                orderReference: 'fin-pack-max-507f1f77bcf86cd799439011-abc',
                transactionStatus: 'Approved',
                amount: 9900, // 99.00 грн → копійки
                currency: 'UAH',
                cardMask: '44****1111',
                recToken: 'tok_123',
            });
            expect(result.event!.providerEventId).toContain('Approved');
        });

        it('accept-відповідь має валідний підпис', async () => {
            const body = signedCallback();
            const result = await service.parseWebhook(
                Buffer.from(JSON.stringify(body))
            );

            const accept = result.acceptResponse!;
            expect(accept.status).toBe('accept');
            const expected = buildAcceptSignature(SECRET, {
                orderReference: String(accept.orderReference),
                status: 'accept',
                time: accept.time as number,
            });
            expect(accept.signature).toBe(expected);
        });

        it('невалідний підпис → null event і null accept', async () => {
            const body = signedCallback();
            body.merchantSignature = 'deadbeef';
            const result = await service.parseWebhook(
                Buffer.from(JSON.stringify(body))
            );
            expect(result.event).toBeNull();
            expect(result.acceptResponse).toBeNull();
        });

        it('розбирає form-urlencoded тіло (JSON у ключі)', async () => {
            const body = signedCallback();
            const encoded = encodeURIComponent(JSON.stringify(body)) + '=';
            const result = await service.parseWebhook(Buffer.from(encoded));
            expect(result.event).not.toBeNull();
            expect(result.event!.orderReference).toBe(body.orderReference);
        });

        it('порожнє тіло → null', async () => {
            const result = await service.parseWebhook(Buffer.from(''));
            expect(result.event).toBeNull();
            expect(result.acceptResponse).toBeNull();
        });
    });

    describe('refund', () => {
        it('Refunded → success', async () => {
            const fetchMock = mockFetchOnce({
                transactionStatus: 'Refunded',
                reasonCode: 1100,
            });
            const result = await service.refund({
                orderReference: 'fin-sub-uid-1',
                amount: 2500,
                currency: 'UAH',
                comment: 'тест',
            });
            expect(result.success).toBe(true);
            const body = JSON.parse(
                (fetchMock.mock.calls[0][1] as { body: string }).body
            );
            expect(body.transactionType).toBe('REFUND');
            expect(body.amount).toBe('25.00');
        });
    });

    describe('regular operations', () => {
        it('removeSubscription з reasonCode 4100 — успіх', async () => {
            const fetchMock = mockFetchOnce({ reasonCode: 4100, reason: 'Ok' });
            await expect(
                service.removeSubscription('fin-sub-uid-1')
            ).resolves.toBeUndefined();
            const body = JSON.parse(
                (fetchMock.mock.calls[0][1] as { body: string }).body
            );
            expect(body.requestType).toBe('REMOVE');
            expect(body.merchantPassword).toBe(SECRET);
        });

        it('removeSubscription з не-4100 — кидає', async () => {
            mockFetchOnce({ reasonCode: 4313, reason: 'Not found' });
            await expect(
                service.removeSubscription('fin-sub-uid-1')
            ).rejects.toThrow(/REMOVE/);
        });

        it('getSubscriptionStatus парсить дати DD.MM.YYYY', async () => {
            mockFetchOnce({
                reasonCode: 4100,
                status: 'Active',
                nextPaymentDate: '15.07.2026',
                lastPayedDate: '15.06.2026',
            });
            const status = await service.getSubscriptionStatus('fin-sub-uid-1');
            expect(status.status).toBe('Active');
            expect(status.nextPaymentDate?.getUTCFullYear()).toBe(2026);
            expect(status.nextPaymentDate?.getUTCMonth()).toBe(6); // липень (0-based)
        });
    });
});
