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
 * **Колір.** Увесь брендинг чорно-білий: текст і лого Finly рендеряться
 * `#000000` на білому. Sprint 14: «розрізнення несуть центр і рамки, не колір»
 * — QR лишається строго Ч/Б для максимальної сканованості.
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

const FILL = '#000000';
const WHITE = '#FFFFFF';

const BAND = { width: 1024, height: 220, padX: 80, maxFontSize: 132 } as const;
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
    return `<path transform="translate(${offsetX} ${offsetY})" d="${path.toPathData(2)}" fill="${FILL}"/>`;
}

/** Inner-вміст Finly-лого, перефарбований у чорний (source — зелений бренд). */
function blackLogoInner(): string {
    const svg = readFileSync(
        join(__dirname, 'assets', 'finly-logo.svg'),
        'utf8'
    );
    const inner = svg
        .replace(/^[\s\S]*?<svg[^>]*>/, '')
        .replace(/<\/svg>\s*$/, '');
    return inner.replace(/fill="#[0-9A-Fa-f]{6}"/g, `fill="${FILL}"`);
}

/** Лого Finly, вписане у квадрат `logoSize` з лівим-верхом у `(x, y)`. */
function logoSvg(x: number, y: number, logoSize: number): string {
    return `<svg x="${x}" y="${y}" width="${logoSize}" height="${logoSize}" viewBox="0 0 1080 1080">${blackLogoInner()}</svg>`;
}

/**
 * Група «лого + назва Finly», відцентрована у box-і. Назва масштабується так,
 * щоб її visual-height ≈ 0.6·logoSize (оптично рівна лого). Лого зліва, назва
 * справа з gap.
 */
function logoWithWordmark(
    boxW: number,
    boxH: number,
    logoSize: number
): string {
    const probe = font.getPath(BRAND_TEXT.wordmark, 0, 0, logoSize);
    const probeBb = probe.getBoundingBox();
    const fontSize = (logoSize * (logoSize * 0.6)) / (probeBb.y2 - probeBb.y1);
    const path = font.getPath(BRAND_TEXT.wordmark, 0, 0, fontSize);
    const bb = path.getBoundingBox();
    const wmW = bb.x2 - bb.x1;
    const wmH = bb.y2 - bb.y1;
    const gap = logoSize * 0.16;
    const contentW = logoSize + gap + wmW;
    const startX = (boxW - contentW) / 2;
    const logoY = (boxH - logoSize) / 2;
    const wmX = startX + logoSize + gap - bb.x1;
    const wmY = (boxH - wmH) / 2 - bb.y1;
    return (
        logoSvg(startX, logoY, logoSize) +
        `<path transform="translate(${wmX} ${wmY})" d="${path.toPathData(2)}" fill="${FILL}"/>`
    );
}

function svgDoc(width: number, height: number, body: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

function textBandSvg(text: string): string {
    const bg = `<rect width="${BAND.width}" height="${BAND.height}" fill="${WHITE}"/>`;
    const body =
        bg +
        centeredText(
            text,
            BAND.width,
            BAND.height,
            BAND.padX,
            BAND.maxFontSize
        );
    return svgDoc(BAND.width, BAND.height, body);
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
        textBandSvg(BRAND_TEXT.nbuStandard),
        'band-nbu-standard.png'
    );
    await writePng(textBandSvg(BRAND_TEXT.slogan), 'band-slogan.png');
    await writePng(logoBandSvg(), 'band-finly.png');
    await writePng(centerSquareSvg(), 'center-finly-square.png');
    await writePng(centerRectSvg(), 'center-finly-rect.png');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
