import { Test } from '@nestjs/testing';

import { QrRenderError } from '../errors';
import {
    QR_LOGO_MAX_RATIO,
    QrLogoCompositor,
} from './qr-logo.compositor';

/**
 * Unit-тести `QrLogoCompositor` — лише input-guards (synchronous checks ДО
 * виклику sharp-pipeline). Real-stack overlay тестується у
 * `qr.service.integration.spec.ts` з реальним sharp + jsqr round-trip.
 *
 * Чому такий поділ: ts-jest + sharp default-export має interop-проблеми
 * у unit-середовищі (без власного mock). У production (nest build) працює
 * нормально, бо tsc генерує commonjs require seamlessly.
 */
describe('QrLogoCompositor — guards', () => {
    let compositor: QrLogoCompositor;

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [QrLogoCompositor],
        }).compile();
        compositor = moduleRef.get(QrLogoCompositor);
    });

    it('відхиляє logoMaxRatio > QR_LOGO_MAX_RATIO (норматив 003 + Q-correction)', async () => {
        await expect(
            compositor.compose(Buffer.from(''), '/no-op.png', {
                qrSizePx: 512,
                logoMaxRatio: QR_LOGO_MAX_RATIO + 0.01,
            })
        ).rejects.toBeInstanceOf(QrRenderError);
    });

    it('відхиляє logoMaxRatio = 0.30 (sprint plan початкова пропозиція, > QR_LOGO_MAX_RATIO)', async () => {
        await expect(
            compositor.compose(Buffer.from(''), '/no-op.png', {
                qrSizePx: 512,
                logoMaxRatio: 0.3,
            })
        ).rejects.toMatchObject({ code: 'QR_LOGO_TOO_LARGE' });
    });

    it('відхиляє logoMaxRatio = 0', async () => {
        await expect(
            compositor.compose(Buffer.from(''), '/no-op.png', {
                qrSizePx: 512,
                logoMaxRatio: 0,
            })
        ).rejects.toMatchObject({ code: 'QR_LOGO_TOO_LARGE' });
    });

    it('відхиляє від\'ємний logoMaxRatio', async () => {
        await expect(
            compositor.compose(Buffer.from(''), '/no-op.png', {
                qrSizePx: 512,
                logoMaxRatio: -0.1,
            })
        ).rejects.toMatchObject({ code: 'QR_LOGO_TOO_LARGE' });
    });

    it('експонує QR_LOGO_MAX_RATIO як публічну константу для consumers', () => {
        expect(QR_LOGO_MAX_RATIO).toBe(0.2);
    });
});
