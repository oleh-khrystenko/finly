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

        it('брендований тип-2 (rect-центр + смуга) все одно сканується', async () => {
            const url = 'https://pay.finly.com.ua/test';
            const png = await service.renderForUrl(url);
            const decoded = await decodeQr(png);
            expect(decoded).toBe(url);
        });

        it('тип-2 зі square-центром теж сканується', async () => {
            const url = 'https://pay.finly.com.ua/test';
            const png = await service.renderForUrl(url, {
                centerFormat: 'square',
            });
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

    // -------------------------------------------------------------------------
    // Sprint 7 §7.6 + Ризик 1 — нормативна сумісність 8-цифрового ЄДРПОУ.
    //
    // Sprint 7 розширює `PayloadInputSchema.receiverTaxId` з лише-РНОКПП
    // (`individualTaxIdZod`, 10 digits + checksum) на union {РНОКПП, ЄДРПОУ}
    // (`payerTaxIdZod`). Норматив НБУ §IV.10.5 явно дозволяє 8 цифр для юр.осіб.
    //
    // **Mitigation Ризику 1:** plan §7.6 acceptance вимагає round-trip через
    // jsqr з 8-digit ЄДРПОУ. Якщо builder зашиває 10-only constraint у raw-byte-
    // limit чи charset-whitelist — цей тест впаде на render або на decode.
    // -------------------------------------------------------------------------

    describe('Sprint 7 — 8-digit ЄДРПОУ round-trip (юр.особа)', () => {
        const VALID_EDRPOU = '12345678';
        const TOV_INPUT: PayloadInput = {
            ...VALID_INPUT,
            receiverName: 'ТОВ Каса Здоровя',
            receiverTaxId: VALID_EDRPOU,
            purpose: 'Оплата комунальних послуг',
        };

        it('003 — 8-digit ЄДРПОУ кладеться у field 9 без модифікації', async () => {
            const png = await service.renderForNbuPayload(TOV_INPUT, '003', {
                host: NBU_HOST_PRIMARY,
            });
            const decoded = await decodeQr(png);
            expect(decoded).not.toBeNull();

            const b64Url = decoded!.slice('https://qr.bank.gov.ua/'.length);
            const payload = Buffer.from(b64Url, 'base64url').toString('utf-8');
            const fields = payload.split('\n');

            expect(fields).toHaveLength(17);
            // Field 9 (0-indexed 8) — "Код одержувача". Норматив §IV.10.5
            // дозволяє 8 (ЄДРПОУ) або 10 (РНОКПП) цифр.
            expect(fields[8]).toBe(VALID_EDRPOU);
            // Sanity: ім'я та призначення коректні (cyrillic не зіпсувався).
            expect(fields[5]).toBe('ТОВ Каса Здоровя');
            expect(fields[11]).toBe('Оплата комунальних послуг');
        });

        it('002 — 8-digit ЄДРПОУ кладеться у field 9 без модифікації', async () => {
            const png = await service.renderForNbuPayload(TOV_INPUT, '002');
            const decoded = await decodeQr(png);
            expect(decoded).not.toBeNull();

            const b64Url = decoded!.slice('https://bank.gov.ua/qr/'.length);
            const payload = Buffer.from(b64Url, 'base64url').toString('utf-8');
            const fields = payload.split('\n');

            expect(fields).toHaveLength(13);
            expect(fields[8]).toBe(VALID_EDRPOU);
        });

        it('individual з 10-digit РНОКПП все ще round-trip-ить (backward-compat)', async () => {
            // Status quo guard: розширення на ЄДРПОУ не повинне зламати наявний
            // потік для type=fop / individual. Тест дублює формат-003 round-trip
            // з input-фікстури, що використовувала RNOKPP до Sprint 7.
            const png = await service.renderForNbuPayload(VALID_INPUT, '003', {
                host: NBU_HOST_PRIMARY,
            });
            const decoded = await decodeQr(png);
            const b64Url = decoded!.slice('https://qr.bank.gov.ua/'.length);
            const payload = Buffer.from(b64Url, 'base64url').toString('utf-8');
            const fields = payload.split('\n');

            expect(fields[8]).toBe('1234567899');
            expect(fields[8]).toHaveLength(10);
        });
    });

    describe('branded overlay viability', () => {
        it('брендований тип-2 на print-розмірі (1024) сканується', async () => {
            const png = await service.renderForUrl(
                'https://pay.finly.com.ua/x',
                { sizePx: 1024 }
            );
            const decoded = await decodeQr(png);
            expect(decoded).toBe('https://pay.finly.com.ua/x');
        }, 20000);
    });
});
