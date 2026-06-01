import { buildQrDownloadFilename } from './download-filename';

describe('buildQrDownloadFilename', () => {
    it('payment-primary → qr-oplata-{slug}.png', () => {
        expect(buildQrDownloadFilename('payment-primary', 'inv-001-5zTV2tUx')).toBe(
            'qr-oplata-inv-001-5zTV2tUx.png'
        );
    });

    it('payment-legacy → qr-oplata-alt-{slug}.png', () => {
        expect(buildQrDownloadFilename('payment-legacy', 'inv-001-5zTV2tUx')).toBe(
            'qr-oplata-alt-inv-001-5zTV2tUx.png'
        );
    });

    it('page → qr-storinka-{slug}.png', () => {
        expect(buildQrDownloadFilename('page', 'Ux6Um0cH')).toBe(
            'qr-storinka-Ux6Um0cH.png'
        );
    });
});
