/**
 * Generates `apps/api/src/modules/qr/assets/hryvnia-symbol.png` — нормативний
 * центральний asset для NBU QR (Sprint 3 рішення C5 + G2).
 *
 * Зразок: PDF постанови НБУ № 97 від 19.08.2025, §II.11–12 ст. 5 — білий круг
 * зі знаком гривні в центрі. Нормативний розмір (відсоток площі) контролюється
 * рендером через `logoMaxRatio` у `QrLogoCompositor`; цей файл — вихідний
 * 1024×1024 PNG-asset, який потім resize-ується під target-QR.
 *
 * Реалізація: SVG-документ зі стандартного гліфу `₴` (U+20B4), згідно нормативу
 * — символ малюється як glyph (не path), бо librsvg+Cairo рендерить його
 * консистентно при наявності системних шрифтів з Currency Sign block (Helvetica,
 * Arial, DejaVu Sans — усі покривають ₴). Sans-serif сімейство відповідає
 * нейтральному стилю PDF-зразка.
 *
 * Запуск (одноразовий, після зміни параметрів):
 *   pnpm --filter api ts-node scripts/generate-hryvnia-asset.ts
 *
 * Коміт: PNG-asset (а не SVG) — runtime-споживач (`QrService`) не має librsvg
 * dependency в production-bundle, лише `sharp` для composite. Скрипт залишається
 * для reproducibility — без нього немає способу відтворити asset, якщо знадобиться.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
import sharp = require('sharp');
import { writeFileSync } from 'fs';
import { join } from 'path';

const SIZE = 1024;
const RADIUS = SIZE / 2 - 4; // 4px gap для anti-aliasing на круглих краях
// Symbol-size ~58% від total. Менше за діаметр круга (≤1016) на ~40% — це
// padding всередині асета, який під фінальним downscale (~102×102 при QR
// size=512, logoMaxRatio=0.2) лишає достатньо «повітря» для jsqr-декодера
// на довгих URL. Перевірено round-trip-тестами на 80+ модульних QR з
// `pay.finly.com.ua/{slug}/{long-invoice-slug}`. Більший symbol → borderline
// fail у CPU-contended runs.
const SYMBOL_SIZE = 600;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${RADIUS}" fill="#FFFFFF" />
  <text
    x="${SIZE / 2}"
    y="${SIZE / 2}"
    font-family="Helvetica, Arial, 'DejaVu Sans', sans-serif"
    font-size="${SYMBOL_SIZE}"
    font-weight="700"
    text-anchor="middle"
    dominant-baseline="central"
    fill="#000000"
  >&#x20B4;</text>
</svg>
`;

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
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
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
