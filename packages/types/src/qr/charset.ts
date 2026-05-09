/**
 * NBU-allowed charset (Додаток 1 §I.4 ст. 4 постанови № 97):
 *
 * > Елемент даних структури QR-коду може містити символи з номерами від 32
 * > (20 hex) до 255 (FF hex), крім символів 127 (7F hex), 152 (98 hex),
 * > 160 (A0 hex) у кодовій таблиці символів Windows-1251 АБО еквіваленти цих
 * > символів у таблиці Unicode UTF-8.
 *
 * Наслідок: дозволені UTF-8 codepoint'и — це **тільки ті, що мають Win1251
 * mapping**. Emoji (☕ U+2615), нестандартний typography, інші Unicode-блоки
 * без Win1251-аналогу — заборонені.
 *
 * Окремо заборонені:
 *   - LF (\n, 0x0A), CR (\r, 0x0D) — це роздільники полів payload; всередині
 *     значення вони ламають кількість полів, що зчитує банк-парсер.
 *   - Усі control chars 0x00-0x1F + DEL 0x7F + 0x98 + 0xA0 (NBSP) — норматив явно.
 *
 * **Public API.** Експонується з `qr/index.ts` для reuse у entity-Zod схемах
 * (`businessNameSchema`, `businessPaymentPurposeTemplateSchema`,
 * `invoicePaymentPurposeSchema`) — закриває інваріант "будь-який валідно
 * збережений Business / Invoice може згенерувати валідний QR" (Sprint 2 §2.2).
 * До Sprint 8 цей валідатор жив internal-only у builder-і (через
 * `_payload-internals.assertNbuCharset`), що порушувало write-side інваріант:
 * невалідний-для-NBU символ проходив save → render QR падав з 500 на public-
 * сторінці (PayloadValidationError → AllExceptionsFilter мапить як
 * INTERNAL_ERROR, бо це не HttpException).
 */

const ALLOWED_CODEPOINTS = new Set<number>();

// 0x20-0x7E — ASCII printable (без DEL 0x7F).
for (let cp = 0x20; cp <= 0x7e; cp += 1) {
    ALLOWED_CODEPOINTS.add(cp);
}

// Latin-1 supplement (Win1251 0xA4-0xBE subset, без 0xA0 NBSP за нормативом).
for (const cp of [
    0x00a4, 0x00a6, 0x00a7, 0x00a9, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x00b0,
    0x00b1, 0x00b5, 0x00b6, 0x00b7, 0x00bb,
]) {
    ALLOWED_CODEPOINTS.add(cp);
}

// Cyrillic main range А-я (Win1251 0xC0-0xFF → U+0410-U+044F).
for (let cp = 0x0410; cp <= 0x044f; cp += 1) {
    ALLOWED_CODEPOINTS.add(cp);
}

// Cyrillic supplement (Win1251 0x80-0x9F + 0xA1-0xBF Cyrillic letters):
// Ё/ё, Ђ/ђ, Ѓ/ѓ, Є/є, Ѕ/ѕ, І/і, Ї/ї, Ј/ј, Љ/љ, Њ/њ, Ћ/ћ, Ќ/ќ, Ў/ў, Џ/џ, Ґ/ґ.
for (const cp of [
    0x0401, 0x0451, 0x0402, 0x0452, 0x0403, 0x0453, 0x0404, 0x0454, 0x0405,
    0x0455, 0x0406, 0x0456, 0x0407, 0x0457, 0x0408, 0x0458, 0x0409, 0x0459,
    0x040a, 0x045a, 0x040b, 0x045b, 0x040c, 0x045c, 0x040e, 0x045e, 0x040f,
    0x045f, 0x0490, 0x0491,
]) {
    ALLOWED_CODEPOINTS.add(cp);
}

// General Punctuation (Win1251 0x80-0x97 typographic specials):
// '–' '—' '‘' '’' '‚' '“' '”' '„' '†' '‡' '•' '…' '‰' '‹' '›' '€' '№' '™'.
for (const cp of [
    0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2020,
    0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2116, 0x2122,
]) {
    ALLOWED_CODEPOINTS.add(cp);
}

/**
 * Шукає перший codepoint, що не входить у NBU-whitelist.
 * Повертає індекс знайденого char (для error reporting), або -1, якщо все ок.
 *
 * Iteration via codePointAt: коректно обробляє surrogate pairs у UTF-16.
 */
export function findInvalidNbuCharIndex(value: string): number {
    for (let i = 0; i < value.length; ) {
        const cp = value.codePointAt(i);
        if (cp === undefined) {
            return i;
        }
        if (!ALLOWED_CODEPOINTS.has(cp)) {
            return i;
        }
        // Surrogate-pair характери (cp > 0xFFFF) займають 2 UTF-16 code units.
        i += cp > 0xffff ? 2 : 1;
    }
    return -1;
}

/**
 * Boolean-варіант для Zod `.refine(...)` callsite-ів. Повертає `true`, якщо
 * усі символи входять у NBU-whitelist (Win1251-mappable, без LF/CR/control).
 *
 * Узгоджений з `isWithinByteLimit` (limits.ts) — спільна форма primitive-
 * level guards для entity-схем.
 */
export function isWithinNbuCharset(value: string): boolean {
    return findInvalidNbuCharIndex(value) === -1;
}
