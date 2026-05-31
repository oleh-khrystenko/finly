/**
 * Generates Sprint-14 QR-branding assets у
 * `apps/api/src/modules/qr/assets/` — смуги (text-bands) і центральні asset-и
 * тип-2 (Finly-лого).
 *
 * **Чому build-time bake у PNG (а не runtime-рендер тексту).** Той самий
 * мотив, що в `generate-hryvnia-asset.ts`: runtime-споживач (`QrLogoCompositor`)
 * не має librsvg / fontconfig dependency у production-bundle — лише `sharp`
 * composite готових PNG. Текст українською промальовується **векторним path**
 * (`opentype.js` text → glyph outline з вбудованого Mulish TTF), а не як
 * SVG `<text>`, тому рендер не залежить від системних шрифтів ні на build-,
 * ні на runtime-машині (Sprint 14 README, ризик «рендеринг тексту на сервері»).
 *
 * **Колір.** Бренд-lockup як у шапці сайту: логотип — рідний зелений SVG
 * (`#00733E` = `--primary`), а wordmark «Finly» і текст-підписи — `INK`
 * (`--foreground` світлої теми, тепло-темний, НЕ чистий чорний). Колір — лише
 * у смугах і центральних плашках, ПОЗА матрицею QR: сама матриця лишається
 * чорно-білою, тож сканованість не зачеплена.
 *
 * Смуги — повноширинні білі strip-и (рендеряться поза quiet-zone у
 * compositor-і). Центральні asset-и — лого/лого+назва на білій rounded-плашці
 * з прозорими кутами (як білий круг гривні), щоб QR проглядав навколо плашки.
 *
 * Запуск (одноразовий, після зміни текстів / параметрів / заміни лого-SVG):
 *   pnpm --filter api ts-node scripts/generate-brand-assets.ts
 *
 * Коміт: PNG-asset-и (не SVG / не шрифт у bundle). Скрипт + source-SVG +
 * build-time devDeps (`opentype.js`, `@expo-google-fonts/mulish`) лишаються
 * для reproducibility.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
import sharp = require('sharp');
import * as opentype from 'opentype.js';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const BRAND_TEXT = {
    nbuStandard: 'Створено за стандартами НБУ',
    slogan: 'Веди справи, а не папери.',
    wordmark: 'Finly',
} as const;

/**
 * Колір тексту (wordmark + підписи). Дорівнює `--foreground` світлої теми
 * (`oklch(0.2 0.018 65)` → `#1c140d`) — тепло-темний, НЕ чистий чорний, рівно
 * як сайт малює «Finly» (`text-foreground`). Логотип лишається у рідному
 * зеленому SVG (`#00733E` = `--primary`) — той самий бренд-lockup, що в шапці
 * сайту: зелений знак + темний wordmark.
 *
 * Колір живе ТІЛЬКИ у смугах/центральних плашках — поза матрицею QR. Сама
 * матриця лишається чорно-білою (сканованість не зачеплена); брендинг у центрі
 * тип-2 лежить на білій плашці, що й так вилучена error-correction-ом.
 */
const INK = '#1C140D';
const WHITE = '#FFFFFF';

interface BandConfig {
    width: number;
    height: number;
    padX: number;
    maxFontSize: number;
}

const BAND: BandConfig = { width: 1024, height: 220, padX: 80, maxFontSize: 132 };

/**
 * Окрема конфігурація для НБУ-compliance-підпису (нижній footer тип-1). На
 * відміну від `BAND`, текст НЕ тягнеться на всю ширину: `maxFontSize` 32
 * прив'язує розмір (фраза спанить ~48% ширини, не 84%), а низька смуга
 * (60 vs 220 → ~6% сторони QR) прибирає вертикальну порожнечу навколо тексту.
 */
const CAPTION_BAND: BandConfig = {
    width: 1024,
    height: 60,
    padX: 80,
    maxFontSize: 32,
};
const CENTER_SQUARE = { size: 1024, logoRatio: 0.6, plateRadius: 96 } as const;
const CENTER_RECT = {
    width: 1280,
    height: 720,
    logoRatio: 0.52,
    plateRadius: 96,
} as const;

const fontPath =
    require.resolve('@expo-google-fonts/mulish/700Bold/Mulish_700Bold.ttf');
const font = opentype.loadSync(fontPath);

const assetsDir = join(__dirname, '..', 'src', 'modules', 'qr', 'assets');

/**
 * Path-рядок тексту, відцентрований у box-і `boxW × boxH`. Розмір шрифту
 * підбирається так, щоб advance вмістився у `boxW - 2·padX`, але не більший
 * за `maxFontSize`. Вертикаль центрується по реальному bounding-box гліфів
 * (не по typographic baseline) — симетрично незалежно від ascender/descender.
 */
function centeredText(
    text: string,
    boxW: number,
    boxH: number,
    padX: number,
    maxFontSize: number
): string {
    const advanceAtUnit = font.getAdvanceWidth(text, 1);
    const fontSize = Math.min(maxFontSize, (boxW - 2 * padX) / advanceAtUnit);
    const path = font.getPath(text, 0, 0, fontSize);
    const bb = path.getBoundingBox();
    const offsetX = (boxW - (bb.x2 - bb.x1)) / 2 - bb.x1;
    const offsetY = (boxH - (bb.y2 - bb.y1)) / 2 - bb.y1;
    return `<path transform="translate(${offsetX} ${offsetY})" d="${path.toPathData(2)}" fill="${INK}"/>`;
}

/** Inner-вміст Finly-лого у рідному зеленому (source-SVG уже `#00733E`). */
function logoInner(): string {
    const svg = readFileSync(
        join(__dirname, 'assets', 'finly-logo.svg'),
        'utf8'
    );
    return svg
        .replace(/^[\s\S]*?<svg[^>]*>/, '')
        .replace(/<\/svg>\s*$/, '');
}

/** Лого Finly, вписане у квадрат `logoSize` з лівим-верхом у `(x, y)`. */
function logoSvg(x: number, y: number, logoSize: number): string {
    return `<svg x="${x}" y="${y}" width="${logoSize}" height="${logoSize}" viewBox="0 0 1080 1080">${logoInner()}</svg>`;
}

/**
 * Група «лого + назва Finly», відцентрована у box-і. Назва масштабується за
 * **cap-height** (а не повним bounding-box-ом): visual cap ≈ 0.68·logoSize, тож
 * текст оптично рівний лого, а не вдвічі дрібніший. Вертикаль центрується по
 * cap-блоку [ascender-top, baseline] — виносний елемент «y» НЕ зсуває текст
 * униз (стара повна-box центровка садила wordmark нижче лого). Лого зліва,
 * назва справа з gap.
 */
function logoWithWordmark(
    boxW: number,
    boxH: number,
    logoSize: number
): string {
    const capTarget = logoSize * 0.68;
    const probe = font.getPath(BRAND_TEXT.wordmark, 0, 0, 1000);
    const probeCap = -probe.getBoundingBox().y1;
    const fontSize = (capTarget * 1000) / probeCap;
    const path = font.getPath(BRAND_TEXT.wordmark, 0, 0, fontSize);
    const bb = path.getBoundingBox();
    const wmW = bb.x2 - bb.x1;
    const gap = logoSize * 0.16;
    const contentW = logoSize + gap + wmW;
    const startX = (boxW - contentW) / 2;
    const logoY = (boxH - logoSize) / 2;
    const wmX = startX + logoSize + gap - bb.x1;
    const wmY = boxH / 2 - bb.y1 / 2;
    return (
        logoSvg(startX, logoY, logoSize) +
        `<path transform="translate(${wmX} ${wmY})" d="${path.toPathData(2)}" fill="${INK}"/>`
    );
}

function svgDoc(width: number, height: number, body: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

function textBandSvg(text: string, band: BandConfig): string {
    const bg = `<rect width="${band.width}" height="${band.height}" fill="${WHITE}"/>`;
    const body =
        bg +
        centeredText(
            text,
            band.width,
            band.height,
            band.padX,
            band.maxFontSize
        );
    return svgDoc(band.width, band.height, body);
}

function logoBandSvg(): string {
    const bg = `<rect width="${BAND.width}" height="${BAND.height}" fill="${WHITE}"/>`;
    const body =
        bg + logoWithWordmark(BAND.width, BAND.height, BAND.height * 0.62);
    return svgDoc(BAND.width, BAND.height, body);
}

function centerSquareSvg(): string {
    const { size, logoRatio, plateRadius } = CENTER_SQUARE;
    const plate = `<rect width="${size}" height="${size}" rx="${plateRadius}" ry="${plateRadius}" fill="${WHITE}"/>`;
    const logoSize = size * logoRatio;
    const offset = (size - logoSize) / 2;
    const body = plate + logoSvg(offset, offset, logoSize);
    return svgDoc(size, size, body);
}

function centerRectSvg(): string {
    const { width, height, logoRatio, plateRadius } = CENTER_RECT;
    const plate = `<rect width="${width}" height="${height}" rx="${plateRadius}" ry="${plateRadius}" fill="${WHITE}"/>`;
    const body = plate + logoWithWordmark(width, height, height * logoRatio);
    return svgDoc(width, height, body);
}

async function writePng(svg: string, fileName: string): Promise<void> {
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    const outputPath = join(assetsDir, fileName);
    writeFileSync(outputPath, buffer);

    console.log(`✅ ${fileName} (${buffer.byteLength} bytes)`);
}

async function main(): Promise<void> {
    await writePng(
        textBandSvg(BRAND_TEXT.nbuStandard, CAPTION_BAND),
        'band-nbu-standard.png'
    );
    await writePng(textBandSvg(BRAND_TEXT.slogan, BAND), 'band-slogan.png');
    await writePng(logoBandSvg(), 'band-finly.png');
    await writePng(centerSquareSvg(), 'center-finly-square.png');
    await writePng(centerRectSvg(), 'center-finly-rect.png');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
