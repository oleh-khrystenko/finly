import { Test } from '@nestjs/testing';
import jsQR from 'jsqr';
// TS-style CJS import — see qr-logo.compositor.ts for rationale.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import sharp = require('sharp');

import { NBU_HOST_PRIMARY, type PayloadInput } from '@finly/types';

import { QrService } from './qr.service';
import { QrImageRenderer } from './renderers/qr-image.renderer';
import { QrLogoCompositor } from './renderers/qr-logo.compositor';

/**
 * Integration-тести QR-pipeline-у з real-stack:
 *   - реальний `qrcode` (PNG generation),
 *   - реальний `sharp` (logo overlay),
 *   - реальний `jsqr` (decoder для round-trip).
 *
 * Чому окремо від unit-spec: ts-jest + sharp default-export interop потребує
 * специфічних обходів у unit. Тут все працює природно, бо ts-jest успішно
 * вантажить sharp за `import sharp from 'sharp'` — як і production-build.
 *
 * `jsqr` доданий як `devDependency` — у production bundle не йде, лише як
 * test-oracle для перевірки, що згенерований PNG зчитується назад у вихідний
 * payload (round-trip integrity).
 */

const VALID_INPUT: PayloadInput = {
    receiverName: 'ФОП Тестовий',
    iban: 'UA213223130000026007233566001',
    receiverTaxId: '1234567899',
    amountKopecks: 12345,
    purpose: 'Оплата за послуги',
};

/**
 * Декодує PNG-буфер у текст QR через `jsqr`. Повертає `null`, якщо QR
 * не зчитався (декодер не зміг розпізнати модулі або CRC failed).
 */
async function decodeQr(pngBuffer: Buffer): Promise<string | null> {
    const { data, info } = await sharp(pngBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const result = jsQR(
        new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
        info.width,
        info.height
    );
    return result?.data ?? null;
}

describe('QrService — integration (real sharp + qrcode + jsqr)', () => {
    let service: QrService;

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [QrService, QrImageRenderer, QrLogoCompositor],
        }).compile();
        service = moduleRef.get(QrService);
    });

    describe('renderForUrl', () => {
        it('генерує PNG, що зчитується назад у вихідний URL', async () => {
            const url =
                'https://pay.finly.com.ua/ivanenko-fop/zamovlennia-aB3xQ9k7';
            const png = await service.renderForUrl(url);
            const decoded = await decodeQr(png);
            expect(decoded).toBe(url);
        });

        it('PNG з накладеним лого все одно сканується (Q-correction tolerance)', async () => {
            const url = 'https://pay.finly.com.ua/test';
            const png = await service.renderForUrl(url, {
                includeLogo: true,
                logoMaxRatio: 0.2,
            });
            const decoded = await decodeQr(png);
            expect(decoded).toBe(url);
        });

        it('PNG без лого — теж сканується (sanity baseline)', async () => {
            const url = 'https://pay.finly.com.ua/test';
            const png = await service.renderForUrl(url, { includeLogo: false });
            const decoded = await decodeQr(png);
            expect(decoded).toBe(url);
        });
    });

    describe('renderForNbuPayload (003) — full round-trip', () => {
        it('build → encode → render → decode → стартує з https://qr.bank.gov.ua/', async () => {
            const png = await service.renderForNbuPayload(VALID_INPUT, '003', {
                host: NBU_HOST_PRIMARY,
            });
            const decoded = await decodeQr(png);
            expect(decoded).not.toBeNull();
            expect(decoded).toMatch(/^https:\/\/qr\.bank\.gov\.ua\//);
        });

        it('декодований Base64URL payload містить нормативні поля у правильному порядку', async () => {
            const png = await service.renderForNbuPayload(VALID_INPUT, '003', {
                host: NBU_HOST_PRIMARY,
            });
            const decoded = await decodeQr(png);
            expect(decoded).not.toBeNull();

            // Виокремлюємо Base64URL частину після префіксу.
            const prefix = 'https://qr.bank.gov.ua/';
            expect(decoded!.startsWith(prefix)).toBe(true);
            const b64Url = decoded!.slice(prefix.length);

            // Decode Base64URL → utf-8 string → split('\n').
            const payload = Buffer.from(b64Url, 'base64url').toString('utf-8');
            const fields = payload.split('\n');

            // 17 полів формату 003 (Додаток 4 таблиця 2).
            expect(fields).toHaveLength(17);
            expect(fields[0]).toBe('BCD');
            expect(fields[1]).toBe('003');
            expect(fields[2]).toBe('1');
            expect(fields[3]).toBe('UCT');
            expect(fields[4]).toBe(''); // RFU
            expect(fields[5]).toBe('ФОП Тестовий');
            expect(fields[6]).toBe('UA213223130000026007233566001');
            expect(fields[7]).toBe('UAH123.45');
            expect(fields[8]).toBe('1234567899');
            expect(fields[9]).toBe('OTHR/GDDS');
            expect(fields[11]).toBe('Оплата за послуги');
            expect(fields[16]).toBe(''); // RFU підпис
        });

        it('логотип не ламає decode для cyrillic-rich payload', async () => {
            const png = await service.renderForNbuPayload(
                {
                    ...VALID_INPUT,
                    receiverName: 'ТОВ "Кав\'ярня"',
                    purpose: 'Оплата за замовлення №147 — кава, тістечко',
                },
                '003',
                {
                    host: NBU_HOST_PRIMARY,
                    includeLogo: true,
                    logoMaxRatio: 0.2,
                }
            );
            const decoded = await decodeQr(png);
            expect(decoded).not.toBeNull();
            // `decoded` — URL з Base64URL payload-у; розпаковуємо щоб перевірити cyrillic-вміст.
            const b64Url = decoded!.slice('https://qr.bank.gov.ua/'.length);
            const payload = Buffer.from(b64Url, 'base64url').toString('utf-8');
            expect(payload).toContain('ТОВ');
            expect(payload).toContain("Кав'ярня");
            expect(payload).toContain('тістечко');
        });
    });

    describe('renderForNbuPayload (002) — full round-trip', () => {
        it('build 002 → стартує з https://bank.gov.ua/qr/', async () => {
            const png = await service.renderForNbuPayload(VALID_INPUT, '002');
            const decoded = await decodeQr(png);
            expect(decoded).not.toBeNull();
            expect(decoded!.startsWith('https://bank.gov.ua/qr/')).toBe(true);
        });

        it('декодований 002 payload має 13 полів (норматив таблиця 2)', async () => {
            const png = await service.renderForNbuPayload(VALID_INPUT, '002');
            const decoded = await decodeQr(png);
            const b64Url = decoded!.slice('https://bank.gov.ua/qr/'.length);
            const payload = Buffer.from(b64Url, 'base64url').toString('utf-8');
            const fields = payload.split('\n');
            expect(fields).toHaveLength(13);
            expect(fields[1]).toBe('002');
        });
    });

    describe('logo overlay viability', () => {
        it('logoMaxRatio = 0.20 (max-allowed) — QR все ще читається', async () => {
            const png = await service.renderForUrl(
                'https://pay.finly.com.ua/x',
                {
                    includeLogo: true,
                    logoMaxRatio: 0.2,
                    sizePx: 512,
                }
            );
            const decoded = await decodeQr(png);
            expect(decoded).toBe('https://pay.finly.com.ua/x');
        });

        it('logoMaxRatio > 0.20 — throw QR_LOGO_TOO_LARGE (норматив guard)', async () => {
            await expect(
                service.renderForUrl('https://pay.finly.com.ua/x', {
                    includeLogo: true,
                    logoMaxRatio: 0.25,
                    sizePx: 512,
                })
            ).rejects.toMatchObject({ code: 'QR_LOGO_TOO_LARGE' });
        });
    });
});
