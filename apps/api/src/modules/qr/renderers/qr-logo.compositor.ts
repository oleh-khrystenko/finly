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
 * Стеля ПЛОЩІ overlay-плашки відносно QR (частка знищених модулів).
 *
 * Sprint 14.x: тип-2 (кастомний QR) — звичайний URL на нашу public-сторінку,
 * НЕ NBU-payload, тож норматив 003 (M/Q-only) на нього не діє. Рендеримо його
 * на `H`-корекції (~30%) і дозволяємо плашку лого+назви до цієї стелі —
 * продуктовий баланс «довжина назви» vs «сканованість». Межу валідовано
 * емпірично (jsQR): суцільна плашка >~16-20% виходить за корекцію навіть на `H`;
 * реальні камери толерантніші, жива сканованість — ручний UAT
 * (`docs/manual-checks`). Тип-1 (NBU) — квадрат `0.2×0.2` (4%) на `Q`, з запасом.
 */
export const QR_OVERLAY_MAX_AREA_RATIO = 0.2;

/** Дефолтний cap ширини плашки як frac QR-сторони (overlay не на всю матрицю). */
export const QR_OVERLAY_DEFAULT_MAX_WIDTH_RATIO = 0.85;

export interface QrLogoComposeOptions {
    /** Ширина QR (= висота, бо QR квадратний). */
    qrSizePx: number;
    /**
     * Дефолт-висота плашки як frac QR-сторони. Ширина НЕ задається — береться з
     * природного аспекту asset-у (лого+назва пікаються «в обтяжку»), тож плашка
     * обтікає контент. Коротка назва → маленька плашка цієї висоти; довша →
     * висота тисне вниз, щоб площа не перевищила `QR_OVERLAY_MAX_AREA_RATIO`
     * (текст дрібнішає, плашка пласкішає).
     */
    idealHeightRatio: number;
    /** Cap ширини як frac QR-сторони (дефолт `QR_OVERLAY_DEFAULT_MAX_WIDTH_RATIO`). */
    maxWidthRatio?: number;
}

/**
 * Опції додавання брендованих смуг навколо QR (Sprint 14).
 *
 * Смуги розширюють полотно **вертикально, поза quiet-zone**: сам QR-buffer
 * (з нормативним 2-модульним margin-ом) лишається недоторканним, смуги
 * приклеюються зверху/знизу. Горизонтальний quiet-zone не змінюється — смуги
 * мають ту саму ширину, що QR.
 */
export interface QrBandOptions {
    /**
     * Сторона QR у px. QR квадратний (`width === height`), тож це і ширина
     * полотна, і висота QR-блоку — окремий metadata-прохід не потрібен.
     * Смуги resize-яться до цієї ширини зі збереженням аспекту.
     */
    width: number;
    /**
     * Верхня смуга (опційно — тип-2 не має верхньої). Локальний шлях до
     * build-time asset-у АБО Buffer (Sprint 21 — кастомна бренд-марка з R2 /
     * щойно запечена). `sharp(input)` приймає обидва нативно.
     */
    topBand?: string | Buffer;
    /** Нижня смуга (опційно). Шлях до asset-у або Buffer. */
    bottomBand?: string | Buffer;
}

/**
 * Накладає центральний asset у центр QR-PNG через `sharp` composite-pipeline.
 *
 * **Параметризація центру (Sprint 14 → 21).** Вибір asset-у живе у caller-і:
 * `QrService` тримає тип-рівневі `QrBrand`-дескриптори (нормативний круг
 * гривні для тип-1, Finly-центр для тип-2) і пробрасує джерело у `renderBranded`.
 * Compositor — generic over `logo: string | Buffer`: Sprint 21 (клієнтський
 * брендинг, «шар C») пробрасує сюди байти пре-композованої бренд-марки (з R2
 * або щойно запеченої), не лише локальний шлях. `sharp(input)` приймає обидва
 * нативно. Назва класу (`Compositor`) залишається generic.
 *
 * Чому окремий клас від `QrImageRenderer`:
 *   - `qrcode` не вміє комбінувати з image overlay (тільки чистий QR).
 *   - `sharp` — native (libvips), важка залежність — ізолюємо composition logic.
 *   - Render+compose split дозволяє переюзати під різні asset-и без рефактора.
 *
 * **Контент-орієнтований розмір (Sprint 14.x).** Caller НЕ задає ширину плашки
 * — лише `idealHeightRatio`. Ширина береться з природного аспекту asset-у
 * (`metadata`), тож плашка обтікає лого+назву. Три правила розміру:
 *   1. Дефолт: висота = `idealHeightRatio·qr`, ширина = `aspect·висота`.
 *   2. Стеля площі: якщо площа > `QR_OVERLAY_MAX_AREA_RATIO` — висота тисне вниз
 *      (аспект збережено), текст дрібнішає, плашка пласкішає.
 *   3. Cap ширини: якщо ширина > `maxWidthRatio·qr` — обрізаємо ширину, висота
 *      підлаштовується (дуже довгі назви; вище за стек назва ще й truncate-иться).
 * Аспект asset-у == аспект плашки → `fit:'contain'` не додає полів, прозорі
 * заокруглені кути показують матрицю QR крізь себе.
 */
@Injectable()
export class QrLogoCompositor {
    async compose(
        qrPng: Buffer,
        logo: string | Buffer,
        opts: QrLogoComposeOptions
    ): Promise<Buffer> {
        if (opts.idealHeightRatio <= 0 || opts.idealHeightRatio > 1) {
            throw new QrRenderError(
                'QR_LOGO_TOO_LARGE',
                'idealHeightRatio must be in (0, 1]'
            );
        }
        const maxWidthRatio =
            opts.maxWidthRatio ?? QR_OVERLAY_DEFAULT_MAX_WIDTH_RATIO;

        let resizedLogo: Buffer;
        try {
            const meta = await sharp(logo).metadata();
            if (!meta.width || !meta.height) {
                throw new Error('asset has no dimensions');
            }
            const aspect = meta.width / meta.height;

            // 1. Дефолт-висота, ширина з аспекту.
            let heightPx = opts.idealHeightRatio * opts.qrSizePx;
            let widthPx = aspect * heightPx;

            // 2. Стеля площі — стиснути зі збереженням аспекту.
            const maxAreaPx =
                QR_OVERLAY_MAX_AREA_RATIO * opts.qrSizePx * opts.qrSizePx;
            if (widthPx * heightPx > maxAreaPx) {
                heightPx = Math.sqrt(maxAreaPx / aspect);
                widthPx = aspect * heightPx;
            }

            // 3. Cap ширини — обрізати, висота підлаштовується.
            const maxWidthPx = maxWidthRatio * opts.qrSizePx;
            if (widthPx > maxWidthPx) {
                widthPx = maxWidthPx;
                heightPx = widthPx / aspect;
            }

            resizedLogo = await sharp(logo)
                .resize(Math.round(widthPx), Math.round(heightPx), {
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
                cause instanceof Error
                    ? cause.message
                    : 'sharp composite failed'
            );
        }
    }

    /**
     * Приклеює брендовані смуги зверху/знизу QR, розширюючи полотно поза
     * quiet-zone. Кожна смуга resize-яться до `width` зі збереженням аспекту;
     * квадратний QR-buffer (сторона = `width`) вставляється між ними без
     * масштабування. Без жодної смуги — повертає вхід без змін (no-op).
     */
    async addBands(qrImage: Buffer, opts: QrBandOptions): Promise<Buffer> {
        if (!opts.topBand && !opts.bottomBand) {
            return qrImage;
        }
        try {
            const top = opts.topBand
                ? await this.resizeBand(opts.topBand, opts.width)
                : null;
            const bottom = opts.bottomBand
                ? await this.resizeBand(opts.bottomBand, opts.width)
                : null;

            const composites: sharp.OverlayOptions[] = [];
            let offsetY = 0;
            if (top) {
                composites.push({ input: top.buffer, left: 0, top: offsetY });
                offsetY += top.height;
            }
            composites.push({ input: qrImage, left: 0, top: offsetY });
            offsetY += opts.width;
            if (bottom) {
                composites.push({
                    input: bottom.buffer,
                    left: 0,
                    top: offsetY,
                });
                offsetY += bottom.height;
            }

            return await sharp({
                create: {
                    width: opts.width,
                    height: offsetY,
                    channels: 4,
                    background: { r: 255, g: 255, b: 255, alpha: 1 },
                },
            })
                .composite(composites)
                .png()
                .toBuffer();
        } catch (cause) {
            throw new QrRenderError(
                'QR_RENDER_FAILED',
                cause instanceof Error
                    ? cause.message
                    : 'sharp band compose failed'
            );
        }
    }

    private async resizeBand(
        band: string | Buffer,
        width: number
    ): Promise<{ buffer: Buffer; height: number }> {
        const { data, info } = await sharp(band)
            .resize({ width, withoutEnlargement: false })
            .png()
            .toBuffer({ resolveWithObject: true });
        return { buffer: data, height: info.height };
    }
}
