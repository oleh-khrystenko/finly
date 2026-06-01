import { buildQrDownloadFilename } from './download-filename';

describe('buildQrDownloadFilename', () => {
    describe('page (без токена типу)', () => {
        it('бізнес-рівень → finly-{biz}.png', () => {
            expect(
                buildQrDownloadFilename('page', { businessSlug: 'apple' })
            ).toBe('finly-apple.png');
        });

        it('рахунок-рівень → finly-{biz}-{acc}.png', () => {
            expect(
                buildQrDownloadFilename('page', {
                    businessSlug: 'apple',
                    accountSlug: 'Ux6Um0cH',
                })
            ).toBe('finly-apple-Ux6Um0cH.png');
        });

        it('інвойс-рівень → finly-{biz}-{acc}-{inv}.png', () => {
            expect(
                buildQrDownloadFilename('page', {
                    businessSlug: 'apple',
                    accountSlug: 'Ux6Um0cH',
                    invoiceSlug: 'inv-001-5zTV2tUx',
                })
            ).toBe('finly-apple-Ux6Um0cH-inv-001-5zTV2tUx.png');
        });
    });

    describe('payment-primary (основна NBU-адреса)', () => {
        it('рахунок-рівень → finly-nbu-{biz}-{acc}.png', () => {
            expect(
                buildQrDownloadFilename('payment-primary', {
                    businessSlug: 'apple',
                    accountSlug: 'Ux6Um0cH',
                })
            ).toBe('finly-nbu-apple-Ux6Um0cH.png');
        });

        it('інвойс-рівень → finly-nbu-{biz}-{acc}-{inv}.png', () => {
            expect(
                buildQrDownloadFilename('payment-primary', {
                    businessSlug: 'apple',
                    accountSlug: 'Ux6Um0cH',
                    invoiceSlug: 'inv-001-5zTV2tUx',
                })
            ).toBe('finly-nbu-apple-Ux6Um0cH-inv-001-5zTV2tUx.png');
        });
    });

    describe('payment-legacy (запасна NBU-адреса)', () => {
        it('рахунок-рівень → finly-nbu-alt-{biz}-{acc}.png', () => {
            expect(
                buildQrDownloadFilename('payment-legacy', {
                    businessSlug: 'apple',
                    accountSlug: 'Ux6Um0cH',
                })
            ).toBe('finly-nbu-alt-apple-Ux6Um0cH.png');
        });

        it('інвойс-рівень → finly-nbu-alt-{biz}-{acc}-{inv}.png', () => {
            expect(
                buildQrDownloadFilename('payment-legacy', {
                    businessSlug: 'apple',
                    accountSlug: 'Ux6Um0cH',
                    invoiceSlug: 'inv-001-5zTV2tUx',
                })
            ).toBe('finly-nbu-alt-apple-Ux6Um0cH-inv-001-5zTV2tUx.png');
        });
    });
});
