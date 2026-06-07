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

// Sandbox-креденшали (wiki 852472). Golden-вектори обчислені незалежно
// (HMAC-MD5 над `;`-конкатенацією) і зашиті як еталон: будь-яка зміна порядку
// полів, роздільника чи алгоритму ламає тест.
const SECRET = 'flk3409refn54t54t*FNJRET';

describe('wayforpay.signature', () => {
    describe('kopecksToAmount / amountToKopecks', () => {
        it('конвертує копійки у decimal-рядок з 2 знаками', () => {
            expect(kopecksToAmount(4900)).toBe('49.00');
            expect(kopecksToAmount(14900)).toBe('149.00');
            expect(kopecksToAmount(154736)).toBe('1547.36');
            expect(kopecksToAmount(0)).toBe('0.00');
        });

        it('конвертує decimal назад у копійки (string і number)', () => {
            expect(amountToKopecks('49.00')).toBe(4900);
            expect(amountToKopecks('1547.36')).toBe(154736);
            expect(amountToKopecks(49)).toBe(4900);
            expect(amountToKopecks('49')).toBe(4900);
        });

        it('round-trip копійки → decimal → копійки', () => {
            for (const k of [1, 49, 4900, 14900, 99999, 154736]) {
                expect(amountToKopecks(kopecksToAmount(k))).toBe(k);
            }
        });
    });

    describe('buildPurchaseSignature', () => {
        it('golden vector — порядок merchant/order/amount/currency/name/count/price', () => {
            const sig = buildPurchaseSignature(SECRET, {
                merchantAccount: 'test_merch_n1',
                merchantDomainName: 'finly.com.ua',
                orderReference: 'fin-sub-abc-1',
                orderDate: 1_700_000_000,
                amount: '49.00',
                currency: 'UAH',
                productNames: ['Підписка Pro'],
                productCounts: [1],
                productPrices: ['49.00'],
            });
            expect(sig).toBe('545267d89042b4ff771f5679391579bd');
        });
    });

    describe('buildRefundSignature', () => {
        it('golden vector — 4 поля merchant/order/amount/currency', () => {
            const sig = buildRefundSignature(SECRET, {
                merchantAccount: 'test_merch_n1',
                orderReference: 'fin-sub-abc-1',
                amount: '49.00',
                currency: 'UAH',
            });
            expect(sig).toBe('80f4ce51649b5211b907ccb3f25f4f62');
        });
    });

    describe('buildWebhookSignature', () => {
        it('golden vector — 8 полів колбеку', () => {
            const sig = buildWebhookSignature(SECRET, {
                merchantAccount: 'test_merch_n1',
                orderReference: 'ORDER-1',
                amount: '49.00',
                currency: 'UAH',
                authCode: '123456',
                cardPan: '44****1111',
                transactionStatus: 'Approved',
                reasonCode: '1100',
            });
            expect(sig).toBe('66d5253492644fde025504ce27e736d6');
        });
    });

    describe('buildAcceptSignature', () => {
        it('golden vector — orderReference/status/time', () => {
            const sig = buildAcceptSignature(SECRET, {
                orderReference: 'ORDER-1',
                status: 'accept',
                time: 1_700_000_000,
            });
            expect(sig).toBe('39dd0aae121e7cf55062a64af4ce34b3');
        });
    });

    describe('signaturesEqual', () => {
        it('true на ідентичних, false на різних і різної довжини', () => {
            expect(signaturesEqual('abc123', 'abc123')).toBe(true);
            expect(signaturesEqual('abc123', 'abc124')).toBe(false);
            expect(signaturesEqual('abc', 'abcd')).toBe(false);
        });
    });

    describe('intervalToRegularMode', () => {
        it('month → monthly, year → yearly', () => {
            expect(intervalToRegularMode('month')).toBe('monthly');
            expect(intervalToRegularMode('year')).toBe('yearly');
        });
    });

    describe('formatRegularDate', () => {
        it('форматує у DD.MM.YYYY (Kyiv-день)', () => {
            // 2026-06-15 12:00 UTC → Kyiv той самий день
            expect(formatRegularDate(new Date('2026-06-15T12:00:00Z'))).toBe(
                '15.06.2026'
            );
            expect(formatRegularDate(new Date('2026-01-05T12:00:00Z'))).toBe(
                '05.01.2026'
            );
        });
    });
});
