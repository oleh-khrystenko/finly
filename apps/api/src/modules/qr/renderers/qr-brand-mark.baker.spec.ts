// eslint-disable-next-line @typescript-eslint/no-require-imports
import sharp = require('sharp');

import { QrBrandMarkBaker } from './qr-brand-mark.baker';

/**
 * Реальний sharp + opentype (без моків): bake-on-commit — найновіша і
 * найризикованіша частина Sprint 21 (runtime-шрифт). Перевіряємо, що марки —
 * валідні PNG очікуваних розмірів для лого-тільки і лого+назва.
 */
describe('QrBrandMarkBaker', () => {
    const baker = new QrBrandMarkBaker();

    async function makeLogo(width: number, height: number): Promise<Buffer> {
        return sharp({
            create: {
                width,
                height,
                channels: 4,
                background: { r: 0, g: 115, b: 62, alpha: 1 },
            },
        })
            .png()
            .toBuffer();
    }

    it('пече валідні PNG-марки для лого-тільки (горизонтальне лого)', async () => {
        const logo = await makeLogo(300, 150);
        const { centerMark, bandMark } = await baker.bake(logo, null);

        const center = await sharp(centerMark).metadata();
        const band = await sharp(bandMark).metadata();

        expect(center.format).toBe('png');
        expect(band.format).toBe('png');
        // Смуга — повноширинна 1024×170 (резайзиться до QR у compositor-і).
        expect(band.width).toBe(1024);
        expect(band.height).toBe(170);
        // Центр «в обтяжку»: ширша за висоту для горизонтального лого.
        expect(center.width).toBeGreaterThan(center.height);
    });

    it('пече валідні PNG-марки для лого + назва', async () => {
        const logo = await makeLogo(200, 200);
        const { centerMark, bandMark } = await baker.bake(
            logo,
            'Кав’ярня Зерно'
        );

        const center = await sharp(centerMark).metadata();
        const band = await sharp(bandMark).metadata();

        expect(center.format).toBe('png');
        expect(band.format).toBe('png');
        expect(band.width).toBe(1024);
        // Назва праворуч від лого → центральна плашка ширша, ніж у лого-тільки.
        expect(center.width).toBeGreaterThan(center.height);
    });

    it('довга назва вписується у фіксовану ширину смуги (1024)', async () => {
        const logo = await makeLogo(200, 200);
        const { bandMark } = await baker.bake(logo, 'я'.repeat(40));

        const band = await sharp(bandMark).metadata();
        expect(band.width).toBe(1024);
        expect(band.height).toBe(170);
    });
});
