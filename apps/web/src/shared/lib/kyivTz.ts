import { INTL_LOCALE } from './intl';

/**
 * Sprint 4 SP-7 — UTC-instant, що в Europe/Kyiv tz відображається як
 * 23:59:59.000 заданого дня.
 *
 * **Чому окремий util.** Frontend форми (`CreateInvoiceForm`,
 * `ValidUntilSection`) приймають date-only через `<input type="date">`. Раніше
 * code робив `new Date(`${yyyy-mm-dd}T23:59:59`)` — це interpret-ується
 * **браузером** як local time, тобто залежить від tz клієнта. Якщо ФОП у
 * відрядженні в UTC+0, він обирає 31 травня → API дістає `2026-05-31T22:59:59Z`
 * (тобто 31 травня 22:59:59Z = 1 червня 01:59:59 Kyiv) — інший день, ніж
 * мав на увазі.
 *
 * Backend (`formatYymmddhhmmss`, `getKyivYearMonth`) явно інтерпретує
 * `validUntil` через `Intl.DateTimeFormat({ timeZone: 'Europe/Kyiv' })`. Тож
 * frontend має передати UTC-instant, що з тз backend-у відповідає `YYYY-MM-DD
 * 23:59:59` Kyiv. Це робить контракт SP-7 ("23:59:59 локальний український
 * час") tz-coherent незалежно від клієнтського часу.
 *
 * **Алгоритм.** Беремо UTC-guess (`Date.UTC(y,m-1,d,23,59,59)`), форматуємо
 * його у Europe/Kyiv через `Intl.DateTimeFormat`, обчислюємо різницю між
 * "що ми хотіли побачити в Kyiv" і "що показала Kyiv-tz". Зсуваємо guess на
 * цю різницю. Одна ітерація достатня для всіх дат, окрім DST-boundary; для
 * безпеки робимо другу ітерацію — якщо результат стабільний, повертаємо.
 *
 * Залежить від ICU tzdata з `Europe/Kyiv` — Node 20+/сучасні браузери full-icu
 * за замовчуванням.
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

interface DateParts {
    y: number;
    mo: number;
    d: number;
    h: number;
    mi: number;
    s: number;
}

function getKyivPartsFromUtc(utcMs: number): DateParts {
    const parts = KYIV_FORMATTER.formatToParts(new Date(utcMs));
    const get = (type: Intl.DateTimeFormatPart['type']): number =>
        Number(parts.find((p) => p.type === type)?.value ?? '0');
    // Intl формат `hour: '2-digit', hour12: false` може повернути '24' для
    // півночі — нормалізуємо у 0.
    const hourRaw = get('hour');
    return {
        y: get('year'),
        mo: get('month'),
        d: get('day'),
        h: hourRaw === 24 ? 0 : hourRaw,
        mi: get('minute'),
        s: get('second'),
    };
}

function partsToUtcMs(p: DateParts): number {
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
}

/**
 * Парсить `YYYY-MM-DD` і повертає `Date`, що в Europe/Kyiv видно як
 * 23:59:59.000 цього дня. Кидає `RangeError` на невалідному вході.
 */
export function kyivEndOfDayInstant(yyyymmdd: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyymmdd);
    if (!match) {
        throw new RangeError(
            `kyivEndOfDayInstant: expected YYYY-MM-DD, got "${yyyymmdd}"`
        );
    }
    const [, ys, ms, ds] = match;
    const target: DateParts = {
        y: Number(ys),
        mo: Number(ms),
        d: Number(ds),
        h: 23,
        mi: 59,
        s: 59,
    };
    const wantedUtcSurfaceMs = partsToUtcMs(target);

    // Step 1: інтерпретуємо input як UTC, обчислюємо діагноз.
    let utcMs = wantedUtcSurfaceMs;
    for (let i = 0; i < 2; i += 1) {
        const observedKyiv = getKyivPartsFromUtc(utcMs);
        const observedUtcSurfaceMs = partsToUtcMs(observedKyiv);
        const diff = wantedUtcSurfaceMs - observedUtcSurfaceMs;
        if (diff === 0) break;
        utcMs += diff;
    }
    return new Date(utcMs);
}

/**
 * Поточні рік і місяць (1-12) у Europe/Kyiv.
 *
 * Той самий інваріант, що у `kyivEndOfDayInstant`, але для «зараз»: усе, що
 * підставляється у платіжний документ (період податку, номер за місяцем),
 * рахується за українським календарем, не за tz середовища. Без цього SSR у
 * UTC-контейнері й браузер у Києві у вікні 00:00-03:00 на межі місяця дають
 * різну відповідь: розбіжність гідратації плюс дефолт на період назад.
 */
export function kyivYearMonth(now: Date = new Date()): {
    year: number;
    month: number;
} {
    const parts = getKyivPartsFromUtc(now.getTime());
    return { year: parts.y, month: parts.mo };
}

const KYIV_DATE_DISPLAY_FORMATTER = new Intl.DateTimeFormat(INTL_LOCALE, {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
});

/**
 * Форматує `Date` як `DD.MM.YYYY` у Europe/Kyiv. `validUntil` має київську
 * семантику (end-of-day Kyiv instant) — форматування у локальній tz браузера
 * показало б сусідній день користувачу поза Києвом. Single source для display
 * київської дати (на відміну від `kyivEndOfDayInstant`, що парсить для backend).
 */
export function formatKyivDate(date: Date): string {
    return KYIV_DATE_DISPLAY_FORMATTER.format(date);
}
