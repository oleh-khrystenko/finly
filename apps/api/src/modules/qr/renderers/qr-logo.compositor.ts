import { Injectable } from '@nestjs/common';
// TS-style CJS import замість `import sharp from 'sharp'` — ts-jest має
// default-import interop баг з sharp ("(0, sharp_1.default) is not a function")
// при реальному runtime-виклику. `import = require()` гарантує однакову
// поведінку у production (nest build) і у ts-jest, бо це канонічна форма
// для callable CJS-модулів у TypeScript.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import sharp = require('sharp');

import { QrRenderError } from '../errors';

/**
 * Жорстка верхня межа на розмір логотипу відносно QR.
 *
 * Норматив 003 (Додаток 4 §IV.10.4 ст. 28) дозволяє рівень корекції помилок
 * `M` (15%) або `Q` (25%). Sprint 2 §2.0 фіксує дефолт `Q` — дозволено
 * перекривати ~25% площі QR. Беремо `0.20` як safe upper-bound у quadrant'і
 * (під 25% площі з запасом на margins/anti-aliasing).
 *
 * Sprint plan §2.3 початково пропонував `0.30` під `H`-correction, але `H`
 * виходить за норматив 003 — деталі у docs/product/qr-spec/diff-002-003.md
 * "Рівень корекції помилок".
 */
export const QR_LOGO_MAX_RATIO = 0.2;

export interface QrLogoComposeOptions {
    /** Ширина QR (= висота, бо QR квадратний). */
    qrSizePx: number;
    /** Frac від QR-розміру для логотипу. Якщо > QR_LOGO_MAX_RATIO → throw. */
    logoMaxRatio: number;
}

/**
 * Накладає Finly-лого у центр QR-PNG через `sharp` composite-pipeline.
 *
 * Чому окремий клас від `QrImageRenderer`:
 *   - `qrcode` не вміє комбінувати з image overlay (тільки чистий QR).
 *   - `sharp` — native (libvips), важка залежність — ізолюємо composition logic.
 *   - У майбутньому Sprint 6 (custom-logo upload) → той самий `compose()` з
 *     іншим `logoPath`. Render+compose split дозволяє переюзати без рефактора.
 *
 * Лого ніколи не масштабується вгору (`without-enlargement` у resize):
 * якщо asset 1024×1024, а QR 512px і ratio 0.2 → лого 102×102 (downscale).
 * Якщо asset менший за target — залишається оригінальний розмір (без blur).
 */
@Injectable()
export class QrLogoCompositor {
    async compose(
        qrPng: Buffer,
        logoPath: string,
        opts: QrLogoComposeOptions
    ): Promise<Buffer> {
        if (opts.logoMaxRatio > QR_LOGO_MAX_RATIO) {
            throw new QrRenderError(
                'QR_LOGO_TOO_LARGE',
                `logoMaxRatio ${opts.logoMaxRatio} > ${QR_LOGO_MAX_RATIO} (норматив 003 + Q-correction)`
            );
        }
        if (opts.logoMaxRatio <= 0) {
            throw new QrRenderError(
                'QR_LOGO_TOO_LARGE',
                'logoMaxRatio must be > 0'
            );
        }

        const logoSizePx = Math.round(opts.qrSizePx * opts.logoMaxRatio);

        let resizedLogo: Buffer;
        try {
            resizedLogo = await sharp(logoPath)
                .resize(logoSizePx, logoSizePx, {
                    fit: 'contain',
                    background: { r: 255, g: 255, b: 255, alpha: 1 },
                    withoutEnlargement: false,
                })
                .png()
                .toBuffer();
        } catch (cause) {
            throw new QrRenderError(
                'QR_LOGO_INVALID',
                cause instanceof Error ? cause.message : 'logo resize failed'
            );
        }

        try {
            return await sharp(qrPng)
                .composite([{ input: resizedLogo, gravity: 'center' }])
                .png()
                .toBuffer();
        } catch (cause) {
            throw new QrRenderError(
                'QR_RENDER_FAILED',
                cause instanceof Error ? cause.message : 'sharp composite failed'
            );
        }
    }
}
