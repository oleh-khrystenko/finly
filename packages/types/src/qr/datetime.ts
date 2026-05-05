/**
 * Sprint 4 §4.1 — конвертація `Date` у `YYMMDDHHmmss` (норматив 003 §II.4.15-16
 * `validUntil` / §II.4.16 `issuedAt`).
 *
 * **Часовий пояс — `Europe/Kyiv`, не UTC і не process-local.** Контракт QR
 * input (`packages/types/src/qr/input.ts:66`) і Sprint 4 §SP-7 фіксують:
 * payload-час інтерпретується як **локальний український час**. Усі ринкові
 * UA-банк-додатки очікують саме його.
 *
 * **Чому НЕ UTC** (раніша версія, що ламала контракт):
 * Frontend серіалізує локальну дату через `toISOString()` → отримує UTC instant
 * (травень: Kyiv 23:59:59 = UTC 20:59:59). Якщо util бере UTC-компоненти, у
 * payload потрапить `260504205959` замість очікуваного `260504235959` — банк-
 * додаток відображає не той час, а у дати поряд із півночі зсувається навіть
 * день.
 *
 * **Чому НЕ process-local (`getFullYear`/...)**:
 * Production server може бути на UTC tz (типово в Atlas/AWS). Date `getFullYear`
 * на UTC-сервері поверне UTC-компоненти — той самий баг, що з `getUTC*`.
 * Залежність від server tz — крихка і не виявляється тестами на dev-машині
 * (де tz зазвичай Kyiv).
 *
 * **Реалізація — `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' })`.**
 *  - `Europe/Kyiv` зона коректно враховує **DST** (літо UTC+3, зима UTC+2)
 *    і всі історичні tz-translation-rules через ICU tzdata.
 *  - `formatToParts` API повертає компоненти як окремі objects — ми збираємо
 *    рядок вручну, без залежності від locale-specific separators ("2026 р."
 *    у uk-UA з year ламало б parsing).
 *  - Locale `en-CA` обрано для numeric-only output без regional quirks
 *    (наприклад, en-US дає "PM" суфікс при 12-hour, що нам не треба).
 *
 * **Edge case ICU `hour: '24'`.** Деякі ICU versions повертають `'24'` для
 * півночі замість `'00'` (older spec ambiguity). Захищаємось явно — якщо
 * `hour === '24'`, замінюємо на `'00'`.
 *
 * **Залежність від ICU tzdata.** Node 20+ ships full-icu за замовчуванням —
 * `Europe/Kyiv` zone доступна без додаткової конфігурації. Якщо runtime
 * використовує small-icu (типово non-default), `formatToParts` поверне
 * GMT-fallback — DST-логіка ламається. На production fail-fast invariant —
 * сервер має повний ICU; цей util не намагається graceful-degrade на
 * UTC-fallback (silent drift гірший за explicit failure).
 *
 * Pure-функція щодо вхідного `Date`-instant; output детермінований.
 */
const KYIV_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
});

/**
 * Internal lookup helper — `formatToParts` повертає обʼєкти типу
 * `{type, value}`; шукаємо за `type`, fail-fast якщо відсутнє (ICU/tzdata
 * misconfig — не silent-degrade).
 */
function lookupPart(
    parts: Intl.DateTimeFormatPart[],
    type: Intl.DateTimeFormatPartTypes,
    caller: string
): string {
    const found = parts.find((p) => p.type === type);
    if (!found) {
        throw new Error(
            `${caller}: missing "${type}" part — ICU/tzdata config issue`
        );
    }
    return found.value;
}

export function formatYymmddhhmmss(date: Date): string {
    const parts = KYIV_FORMATTER.formatToParts(date);
    const yyyy = lookupPart(parts, 'year', 'formatYymmddhhmmss');
    const MM = lookupPart(parts, 'month', 'formatYymmddhhmmss');
    const DD = lookupPart(parts, 'day', 'formatYymmddhhmmss');
    let HH = lookupPart(parts, 'hour', 'formatYymmddhhmmss');
    if (HH === '24') HH = '00';
    const mm = lookupPart(parts, 'minute', 'formatYymmddhhmmss');
    const ss = lookupPart(parts, 'second', 'formatYymmddhhmmss');
    const yy = yyyy.slice(-2);
    return `${yy}${MM}${DD}${HH}${mm}${ss}`;
}

/**
 * Sprint 4 §4.1 — Kyiv-локальні `{ year, month }` для slug-пресетів
 * `with-year` / `with-month`.
 *
 * **Чому НЕ `getUTCFullYear / getUTCMonth`** (раніша версія, що ламала
 * бухгалтерську звітність):
 * Slug immutable після створення, а пресет описаний як "рік-місяць + номер у
 * місяці" (`docs/product/qr-decisions.md` §4.3.1). UTC-компоненти на межі
 * дня дають неправильний звітний період: інвойс, виставлений 1 червня 00:30
 * Київ-час, у UTC ще 31 травня 21:30Z → slug отримав би `2026-05-...` замість
 * `2026-06-...`, ламаючи monthly-counter і звітні зведення ФОП.
 *
 * **Той самий `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' })`,**
 * що `formatYymmddhhmmss`. Семантика однорідна по всьому Sprint 4: і payload-
 * datetime, і slug-prefix — у локальному українському часі.
 *
 * Повертає `month` у людському range `[1, 12]` (не JS-`getMonth` `[0, 11]`),
 * щоб caller-у не доводилось пам'ятати про off-by-one.
 */
const KYIV_YEAR_MONTH_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
});

export function getKyivYearMonth(date: Date): {
    year: number;
    month: number;
} {
    const parts = KYIV_YEAR_MONTH_FORMATTER.formatToParts(date);
    const yearStr = lookupPart(parts, 'year', 'getKyivYearMonth');
    const monthStr = lookupPart(parts, 'month', 'getKyivYearMonth');
    return { year: parseInt(yearStr, 10), month: parseInt(monthStr, 10) };
}
