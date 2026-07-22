/**
 * Generates `apps/api/src/modules/qr/assets/hryvnia-symbol.png` — нормативний
 * центральний asset для NBU QR (Sprint 3 рішення C5 + G2).
 *
 * Зразок: PDF постанови НБУ № 97 від 19.08.2025, §II.11–12 ст. 5 — білий круг
 * зі знаком гривні в центрі. Нормативний розмір (відсоток площі) контролюється
 * рендером через `logoMaxRatio` у `QrLogoCompositor`; цей файл — вихідний
 * 1024×1024 PNG-asset, який потім resize-ується під target-QR.
 *
 * Реалізація: знак гривні береться як **векторний path** з канонічного SVG
 * (`scripts/assets/hryvnia-symbol.svg`, джерело — Wikimedia Commons, public
 * domain, офіційна форма ₴). Path, на відміну від текстового гліфа, центрується
 * по геометричному bounding-box — симетрично, без залежності від типографічної
 * baseline та наявності системних шрифтів з Currency Sign block. Path вписується
 * у білий круг через nested `<svg>` з `viewBox` + `preserveAspectRatio` (авто-
 * масштаб + центрування).
 *
 * Запуск (одноразовий, після зміни параметрів або заміни source-SVG):
 *   pnpm --filter api ts-node scripts/generate-hryvnia-asset.ts
 *
 * Коміт: PNG-asset (а не SVG) — runtime-споживач (`QrService`) не має librsvg
 * dependency в production-bundle, лише `sharp` для composite. Скрипт + source-SVG
 * лишаються для reproducibility.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
import sharp = require('sharp');
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const SIZE = 1024;
const RADIUS = SIZE / 2 - 4; // 4px gap для anti-aliasing на круглих краях
// Висота знаку (у пікселях asset-а) ≈ реальна visual-height попереднього
// текстового гліфа (font-size 600 давав cap-height ~450). Path-версія задає
// розмір напряму, тому беремо саме visual-height, а не em-size. Лишає те саме
// «повітря» в білому крузі під фінальним downscale (~102×102 при QR size=512,
// logoMaxRatio=0.2) для jsqr-декодера на довгих URL. Перевірено round-trip.
const GLYPH_HEIGHT = 450;

function extract(source: string, re: RegExp, label: string): string {
    const match = source.match(re);
    if (!match) {
        throw new Error(`hryvnia-symbol.svg: не знайдено ${label}`);
    }
    return match[1];
}

function buildSvg(): string {
    const glyphSource = readFileSync(
        join(__dirname, 'assets', 'hryvnia-symbol.svg'),
        'utf8'
    );
    const glyphViewBox = extract(glyphSource, /viewBox="([^"]+)"/, 'viewBox');
    const glyphPath = extract(glyphSource, /<path[^>]*\sd="([^"]+)"/, 'path d');

    const [, , vbWidthRaw, vbHeightRaw] = glyphViewBox.trim().split(/\s+/);
    const vbWidth = Number(vbWidthRaw);
    const vbHeight = Number(vbHeightRaw);
    if (!vbWidth || !vbHeight) {
        throw new Error(
            `hryvnia-symbol.svg: некоректний viewBox "${glyphViewBox}"`
        );
    }

    const glyphWidth = (GLYPH_HEIGHT * vbWidth) / vbHeight;
    const glyphX = (SIZE - glyphWidth) / 2;
    const glyphY = (SIZE - GLYPH_HEIGHT) / 2;

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${RADIUS}" fill="#FFFFFF" />
  <svg x="${glyphX}" y="${glyphY}" width="${glyphWidth}" height="${GLYPH_HEIGHT}" viewBox="${glyphViewBox}" preserveAspectRatio="xMidYMid meet">
    <path d="${glyphPath}" fill="#000000" />
  </svg>
</svg>
`;
}

async function main(): Promise<void> {
    const outputPath = join(
        __dirname,
        '..',
        'src',
        'modules',
        'qr',
        'assets',
        'hryvnia-symbol.png'
    );
    const buffer = await sharp(Buffer.from(buildSvg())).png().toBuffer();
    writeFileSync(outputPath, buffer);
    // eslint-disable-next-line no-console
    console.log(
        `✅ Generated ${outputPath} (${buffer.byteLength} bytes, ${SIZE}×${SIZE})`
    );
}

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});
