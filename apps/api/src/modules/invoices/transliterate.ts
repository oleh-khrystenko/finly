/**
 * Sprint 4 §4.1 SP-1 — Cyrillic → Latin transliteration + slugify для preset
 * `with-purpose`.
 *
 * **Чому власна таблиця, а не `cyrillic-to-translit-js`.** Менше залежностей,
 * детермінована (контролюємо точно, як маппимо), і transliteration таблиця
 * для української мови — фіксована (КМУ 2010 passport-style стандарт).
 *
 * **Контекстні правила КМУ (initial-of-word forms `ye/yu/ya/yi`).** Свідомо
 * **не реалізуємо** — для slug-context-у, де ми все одно lowercase-im та
 * зриваємо межі слів через kebab-case-нормалізацію, contextual rules дають
 * marginal improvement читабельності і додають state-machine складність.
 * Однотипний middle-of-word translit (є→ie, ю→iu, я→ia, ї→i) — детермінований
 * і достатній для slug-purpose URL-у.
 *
 * **Російські символи** (ё, ы, э, ъ) включаємо як safety-net на випадок
 * mixed-input або copy-paste з російських джерел; map-имо нейтрально.
 *
 * **Apostrophes** (звичайний `'` і typographic `'` U+2019) — drop-аємо: в
 * slug-у вони все одно нормалізувалися б у `-`, що псує читабельність
 * ("м'ясо" → "m-aso" замість "miaso"). Ь — теж drop (КМУ-стандарт).
 */
const TRANSLIT_MAP: Record<string, string> = {
    // Українські
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'h',
    ґ: 'g',
    д: 'd',
    е: 'e',
    є: 'ie',
    ж: 'zh',
    з: 'z',
    и: 'y',
    і: 'i',
    ї: 'i',
    й: 'i',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'kh',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'shch',
    ь: '',
    ю: 'iu',
    я: 'ia',
    // Російські (safety-net)
    ё: 'e',
    ы: 'y',
    э: 'e',
    ъ: '',
    // Apostrophes — drop
    "'": '',
    '’': '', // ’ U+2019 RIGHT SINGLE QUOTATION MARK
    ʼ: '', // ʼ U+02BC MODIFIER LETTER APOSTROPHE
};

/**
 * Транслітерація + slugify для `with-purpose`-пресета.
 *
 * Pipeline:
 *  1. lowercase (через `String.prototype.toLowerCase()` — UTF-aware).
 *  2. Iterate code-points; для кожного (а) перевіряємо TRANSLIT_MAP, (б) якщо
 *     ASCII alphanumeric — лишаємо as-is, (в) інакше — `-` (placeholder).
 *  3. Collapse multiple `-` → single.
 *  4. Trim leading/trailing `-`.
 *  5. Truncate до 60 chars + повторний trim (на випадок trailing-`-` після
 *     обрізання).
 *
 * **Edge-case empty result.** Якщо input — лише emoji / non-cyrillic-non-ascii
 * / лише пробіли — output `''`. Caller (`InvoiceSlugGeneratorService`) у
 * такому разі fallback-ує на рівень 3 (`{ slug: <tail>, slugPreset: null }`).
 *
 * **Iteration через spread-operator** (`[...str]`) — UTF-16 surrogate pairs
 * (emoji) обробляються як єдиний code-point, а не як два окремі units.
 * Це прибирає ризик "половин"-emoji у проміжному рядку.
 */
export function slugifyPurpose(input: string): string {
    const lowered = input.toLowerCase();
    const out: string[] = [];
    for (const ch of lowered) {
        if (ch in TRANSLIT_MAP) {
            out.push(TRANSLIT_MAP[ch]);
        } else if (/^[a-z0-9]$/.test(ch)) {
            out.push(ch);
        } else {
            out.push('-');
        }
    }
    return out
        .join('')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60)
        .replace(/^-|-$/g, '');
}
