import { join } from 'path';

import { Injectable } from '@nestjs/common';
import * as opentype from 'opentype.js';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- ts-jest default-import interop bug з sharp (див. qr-logo.compositor.ts)
import sharp = require('sharp');

import { QrRenderError } from '../errors';

/**
 * Sprint 21 — bake-on-commit кастомної бренд-марки отримувача.
 *
 * Композує завантажений РАСТРОВИЙ логотип (PNG/JPEG/WEBP) плюс опційну текстову
 * назву нашим шрифтом у дві готові марки під дві позиції QR-рендеру:
 *   - `centerMark` — плашка «в обтяжку» (лого [+ назва]) для ЦЕНТРУ сторінкового
 *     QR (тип-2), на білому rounded-rect із прозорими кутами (матриця проглядає).
 *   - `bandMark` — повноширинна біла смуга (лого [+ назва]) для ВЕРХНЬОЇ смуги
 *     НБУ-QR (тип-1), замість Finly-смуги.
 *
 * Текст промальовується **векторним path** через `opentype.js` (glyph outline з
 * вбудованого Mulish TTF), як у `scripts/generate-brand-assets.ts` — рендер не
 * залежить від librsvg-text / fontconfig / системних шрифтів. Bake-on-commit
 * вводить шрифт у RUNTIME-залежність API (раніше лише build-time): TTF
 * забандлено у `qr/assets/` і копіюється у `dist` через nest-cli.
 *
 * Колір тексту — `INK` (`--foreground` світлої теми), як у Finly-марок. Колір
 * живе лише у плашці/смузі, ПОЗА матрицею QR — сканованість не зачеплена.
 */

const INK = '#1C140D';
const WHITE = '#FFFFFF';

/** Робоча роздільність логотипа у центральній марці (не розмір на QR). */
const CENTER_LOGO_PX = 400;
/** Padding плашки як частки висоти логотипа (дзеркало CENTER_RECT_LOCKUP). */
const CENTER_PAD_X_RATIO = 0.24;
const CENTER_PAD_Y_RATIO = 0.18;
const CENTER_PLATE_RADIUS_RATIO = 0.16;

/** Повноширинна смуга тип-1 (дзеркало FINLY_BAND). */
const BAND_WIDTH = 1024;
const BAND_HEIGHT = 170;
const BAND_LOGO_RATIO = 0.66;
const BAND_PAD_X = 80;

/** Текст оптично рівний лого: cap-height ≈ 0.68·висоти лого. Gap між ними. */
const TEXT_CAP_RATIO = 0.68;
const TEXT_GAP_RATIO = 0.16;

export interface BakedBrandMarks {
    centerMark: Buffer;
    bandMark: Buffer;
}

@Injectable()
export class QrBrandMarkBaker {
    /**
     * Шрифт вантажиться раз на процес. `__dirname` = `dist/modules/qr/renderers`
     * (prod) / `src/...` (dev); TTF лежить у сусідній `../assets` (копіюється у
     * dist через nest-cli `assets`-config, як PNG-марки).
     */
    private readonly font = opentype.loadSync(
        join(__dirname, '..', 'assets', 'mulish-700.ttf')
    );

    async bake(
        logo: Buffer,
        displayName: string | null
    ): Promise<BakedBrandMarks> {
        try {
            const [centerMark, bandMark] = await Promise.all([
                this.bakeCenter(logo, displayName),
                this.bakeBand(logo, displayName),
            ]);
            return { centerMark, bandMark };
        } catch (cause) {
            throw new QrRenderError(
                'QR_RENDER_FAILED',
                cause instanceof Error
                    ? cause.message
                    : 'brand mark bake failed'
            );
        }
    }

    /** Центральна марка (тип-2): плашка «в обтяжку» з прозорими кутами. */
    private async bakeCenter(
        logo: Buffer,
        displayName: string | null
    ): Promise<Buffer> {
        const { data: logoPng, info } = await sharp(logo)
            .resize({ height: CENTER_LOGO_PX, withoutEnlargement: false })
            .png()
            .toBuffer({ resolveWithObject: true });
        const logoW = info.width;
        const logoH = info.height;

        const padX = Math.round(CENTER_LOGO_PX * CENTER_PAD_X_RATIO);
        const padY = Math.round(CENTER_LOGO_PX * CENTER_PAD_Y_RATIO);

        if (!displayName) {
            const plateW = logoW + 2 * padX;
            const plateH = logoH + 2 * padY;
            const svg = this.plateSvg(plateW, plateH);
            return this.compositeLogo(svg, plateW, plateH, logoPng, padX, padY);
        }

        const text = this.measureText(displayName, logoH * TEXT_CAP_RATIO);
        const gap = Math.round(logoH * TEXT_GAP_RATIO);
        const contentW = logoW + gap + text.width;
        const plateW = Math.round(contentW + 2 * padX);
        const plateH = logoH + 2 * padY;

        const logoX = padX;
        const logoY = padY;
        const textX = padX + logoW + gap - text.bbX1;
        const textY = plateH / 2 - text.bbY1 / 2;

        const svg = this.plateSvg(
            plateW,
            plateH,
            this.textPath(text.pathData, textX, textY)
        );
        return this.compositeLogo(svg, plateW, plateH, logoPng, logoX, logoY);
    }

    /** Верхня смуга (тип-1): повноширинна біла, контент відцентровано. */
    private async bakeBand(
        logo: Buffer,
        displayName: string | null
    ): Promise<Buffer> {
        const logoH = Math.round(BAND_HEIGHT * BAND_LOGO_RATIO);
        const { data: logoPng, info } = await sharp(logo)
            .resize({ height: logoH, withoutEnlargement: false })
            .png()
            .toBuffer({ resolveWithObject: true });
        const logoW = info.width;

        const bg = `<rect width="${BAND_WIDTH}" height="${BAND_HEIGHT}" fill="${WHITE}"/>`;

        if (!displayName) {
            const logoX = Math.round((BAND_WIDTH - logoW) / 2);
            const logoY = Math.round((BAND_HEIGHT - info.height) / 2);
            const svg = this.svgDoc(BAND_WIDTH, BAND_HEIGHT, bg);
            return this.compositeLogo(
                svg,
                BAND_WIDTH,
                BAND_HEIGHT,
                logoPng,
                logoX,
                logoY
            );
        }

        // Текст мусить вміститись у смугу поряд з лого: спершу cap-розмір, далі
        // звужуємо до доступної ширини (довгі назви), як `centeredText`.
        const gap = Math.round(logoH * TEXT_GAP_RATIO);
        const availTextW = BAND_WIDTH - 2 * BAND_PAD_X - logoW - gap;
        const text = this.measureText(
            displayName,
            logoH * TEXT_CAP_RATIO,
            availTextW
        );
        const contentW = logoW + gap + text.width;
        const startX = (BAND_WIDTH - contentW) / 2;
        const logoX = Math.round(startX);
        const logoY = Math.round((BAND_HEIGHT - info.height) / 2);
        const textX = startX + logoW + gap - text.bbX1;
        const textY = BAND_HEIGHT / 2 - text.bbY1 / 2;

        const svg = this.svgDoc(
            BAND_WIDTH,
            BAND_HEIGHT,
            bg + this.textPath(text.pathData, textX, textY)
        );
        return this.compositeLogo(
            svg,
            BAND_WIDTH,
            BAND_HEIGHT,
            logoPng,
            logoX,
            logoY
        );
    }

    /**
     * Метрики тексту: розмір шрифту за cap-height, опційно звужений до `maxWidth`
     * (advance не має перевищити доступну ширину). Повертає path-дані + bbox для
     * cap-центрування (зсув по реальному bounding-box гліфів, не baseline).
     */
    private measureText(
        text: string,
        capTarget: number,
        maxWidth?: number
    ): { pathData: string; width: number; bbX1: number; bbY1: number } {
        const probeCap = -this.font.getPath(text, 0, 0, 1000).getBoundingBox()
            .y1;
        let fontSize = (capTarget * 1000) / probeCap;
        if (maxWidth !== undefined) {
            const advanceAtUnit = this.font.getAdvanceWidth(text, 1);
            fontSize = Math.min(fontSize, maxWidth / advanceAtUnit);
        }
        const path = this.font.getPath(text, 0, 0, fontSize);
        const bb = path.getBoundingBox();
        return {
            pathData: path.toPathData(2),
            width: bb.x2 - bb.x1,
            bbX1: bb.x1,
            bbY1: bb.y1,
        };
    }

    private textPath(pathData: string, x: number, y: number): string {
        return `<path transform="translate(${x} ${y})" d="${pathData}" fill="${INK}"/>`;
    }

    /** Біла rounded-rect плашка (прозорі кути) з опційним body поверх. */
    private plateSvg(width: number, height: number, body = ''): string {
        const radius = Math.round(height * CENTER_PLATE_RADIUS_RATIO);
        const plate = `<rect width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="${WHITE}"/>`;
        return this.svgDoc(width, height, plate + body);
    }

    private svgDoc(width: number, height: number, body: string): string {
        return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
    }

    private async compositeLogo(
        svg: string,
        width: number,
        height: number,
        logoPng: Buffer,
        left: number,
        top: number
    ): Promise<Buffer> {
        return sharp(Buffer.from(svg))
            .resize(width, height)
            .composite([{ input: logoPng, left, top }])
            .png()
            .toBuffer();
    }
}
