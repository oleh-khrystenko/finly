import { Test } from '@nestjs/testing';

import { QrRenderError } from '../errors';
import { QrImageRenderer } from './qr-image.renderer';

describe('QrImageRenderer', () => {
    let renderer: QrImageRenderer;

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [QrImageRenderer],
        }).compile();
        renderer = moduleRef.get(QrImageRenderer);
    });

    it('повертає PNG-буфер (signature `\\x89PNG\\r\\n\\x1A\\n`)', async () => {
        const buf = await renderer.render('https://qr.bank.gov.ua/QkNECjAwMw', {
            sizePx: 256,
            errorCorrection: 'Q',
        });
        expect(buf).toBeInstanceOf(Buffer);
        // Перевіряємо PNG magic bytes — точна сигнатура файла.
        expect(buf.subarray(0, 8)).toEqual(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        );
    });

    it.each(['L', 'M', 'Q', 'H'] as const)(
        'приймає errorCorrection=%s',
        async (level) => {
            const buf = await renderer.render('test', {
                sizePx: 256,
                errorCorrection: level,
            });
            expect(buf.length).toBeGreaterThan(0);
        }
    );

    it('детермінований: однаковий input → однаковий output', async () => {
        const a = await renderer.render('https://qr.bank.gov.ua/AAAA', {
            sizePx: 256,
            errorCorrection: 'Q',
        });
        const b = await renderer.render('https://qr.bank.gov.ua/AAAA', {
            sizePx: 256,
            errorCorrection: 'Q',
        });
        expect(a.equals(b)).toBe(true);
    });

    it('різні input → різні output (sensitivity)', async () => {
        const a = await renderer.render('https://qr.bank.gov.ua/AAAA', {
            sizePx: 256,
            errorCorrection: 'Q',
        });
        const b = await renderer.render('https://qr.bank.gov.ua/BBBB', {
            sizePx: 256,
            errorCorrection: 'Q',
        });
        expect(a.equals(b)).toBe(false);
    });

    it('відмова сервісу qrcode перепакована у QrRenderError', async () => {
        // Викликаємо з input, що qrcode не може закодувати: занадто довгий
        // текст для QR-version 40 з high error correction. ~3000 chars buffer overflow.
        const huge = 'A'.repeat(10_000);
        await expect(
            renderer.render(huge, { sizePx: 256, errorCorrection: 'H' })
        ).rejects.toBeInstanceOf(QrRenderError);
    });
});
