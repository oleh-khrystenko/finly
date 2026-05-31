import { Test } from '@nestjs/testing';

import { QrRenderError } from '../errors';
import {
    QR_OVERLAY_DEFAULT_MAX_WIDTH_RATIO,
    QR_OVERLAY_MAX_AREA_RATIO,
    QrLogoCompositor,
} from './qr-logo.compositor';

/**
 * Unit-тести `QrLogoCompositor` — лише input-guards (synchronous checks ДО
 * виклику sharp-pipeline). Контент-орієнтований розмір (аспект asset-у → стеля
 * площі → cap ширини) перевіряється end-to-end у `qr.service.integration.spec.ts`
 * з реальним sharp.
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

    it('відхиляє idealHeightRatio = 0', async () => {
        await expect(
            compositor.compose(Buffer.from(''), '/no-op.png', {
                qrSizePx: 512,
                idealHeightRatio: 0,
            })
        ).rejects.toMatchObject({ code: 'QR_LOGO_TOO_LARGE' });
    });

    it("відхиляє від'ємний idealHeightRatio", async () => {
        await expect(
            compositor.compose(Buffer.from(''), '/no-op.png', {
                qrSizePx: 512,
                idealHeightRatio: -0.1,
            })
        ).rejects.toMatchObject({ code: 'QR_LOGO_TOO_LARGE' });
    });

    it('відхиляє idealHeightRatio > 1 (плашка вища за QR)', async () => {
        await expect(
            compositor.compose(Buffer.from(''), '/no-op.png', {
                qrSizePx: 512,
                idealHeightRatio: 1.2,
            })
        ).rejects.toMatchObject({ code: 'QR_LOGO_TOO_LARGE' });
    });

    it('валідний ratio проходить guard → падає на sharp (немає asset-у) як QR_LOGO_INVALID', async () => {
        // idealHeightRatio валідний → sync-guard НЕ кидає; далі sharp читає
        // metadata неіснуючого файлу → QR_LOGO_INVALID (не TOO_LARGE).
        await expect(
            compositor.compose(Buffer.from(''), '/no-op.png', {
                qrSizePx: 512,
                idealHeightRatio: 0.19,
            })
        ).rejects.toMatchObject({ code: 'QR_LOGO_INVALID' });
    });

    it('guard-помилка — QrRenderError', async () => {
        await expect(
            compositor.compose(Buffer.from(''), '/no-op.png', {
                qrSizePx: 512,
                idealHeightRatio: 2,
            })
        ).rejects.toBeInstanceOf(QrRenderError);
    });

    it('експонує публічні константи для consumers', () => {
        expect(QR_OVERLAY_MAX_AREA_RATIO).toBe(0.2);
        expect(QR_OVERLAY_DEFAULT_MAX_WIDTH_RATIO).toBe(0.85);
    });
});
