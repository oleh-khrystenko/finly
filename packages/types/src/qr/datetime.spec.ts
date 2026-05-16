import { formatYymmddhhmmss, getKyivYearMonth } from './datetime';

/**
 * Sprint 4 §4.1 — verifies, що util повертає компоненти у часовому поясі
 * `Europe/Kyiv`, не UTC і не process-local. Покриває критичний контракт:
 *  - QR input semantic — `validUntil` / `issuedAt` як локальний UA-час.
 *  - DST переходи (літо UTC+3, зима UTC+2).
 *  - Midnight rollover на межі днів.
 */
describe('formatYymmddhhmmss (Sprint 4 §4.1, Europe/Kyiv tz)', () => {
    it('Sprint-plan example: ФОП обрав 2026-05-04 23:59:59 Kyiv (DST UTC+3)', () => {
        // Frontend: new Date('2026-05-04T23:59:59+03:00').toISOString()
        //         = '2026-05-04T20:59:59.000Z' (UTC instant)
        // Util має повернути локальні Kyiv-компоненти.
        const utcInstant = new Date('2026-05-04T20:59:59.000Z');
        expect(formatYymmddhhmmss(utcInstant)).toBe('260504235959');
    });

    it('зимова дата (без DST): ФОП обрав 2026-12-15 23:59:59 Kyiv (UTC+2)', () => {
        const utcInstant = new Date('2026-12-15T21:59:59.000Z');
        expect(formatYymmddhhmmss(utcInstant)).toBe('261215235959');
    });

    it('midnight rollover вперед: UTC 21:00 травня 4 = Kyiv 00:00 травня 5', () => {
        // DST період (UTC+3); середина ночі переходить у наступний день.
        const utcInstant = new Date('2026-05-04T21:00:00.000Z');
        expect(formatYymmddhhmmss(utcInstant)).toBe('260505000000');
    });

    it('midnight rollover (winter): UTC 22:00 грудня 15 = Kyiv 00:00 грудня 16', () => {
        const utcInstant = new Date('2026-12-15T22:00:00.000Z');
        expect(formatYymmddhhmmss(utcInstant)).toBe('261216000000');
    });

    it('повертає рівно 12 цифр для будь-якого валідного Date', () => {
        const result = formatYymmddhhmmss(new Date('2099-06-15T10:00:00.000Z'));
        expect(result).toHaveLength(12);
        expect(result).toMatch(/^\d{12}$/);
    });

    it('zero-pads single-digit month/day/hour/minute/second', () => {
        // Січень 1 2026 03:02:03 Kyiv (зима UTC+2) = UTC 01:02:03 січня 1.
        const utcInstant = new Date('2026-01-01T01:02:03.000Z');
        expect(formatYymmddhhmmss(utcInstant)).toBe('260101030203');
    });

    it('рік 2000 → "00"', () => {
        // Січень 1 2000 03:00 Kyiv (зима UTC+2) = UTC 01:00 січня 1.
        const utcInstant = new Date('2000-01-01T01:00:00.000Z');
        expect(formatYymmddhhmmss(utcInstant)).toBe('000101030000');
    });

    it('детермінованість: той самий instant → той самий output (process-tz invariant)', () => {
        // Цей тест фіксує контракт: process.env.TZ change не вплине на output.
        // Ми не міняємо tz у тесті (process-side effect), але логіка засновується
        // на `Intl.DateTimeFormat({ timeZone: 'Europe/Kyiv' })`, який ігнорує
        // process tz за визначенням.
        const instant = new Date('2026-07-15T09:30:45.000Z'); // Kyiv 12:30:45
        expect(formatYymmddhhmmss(instant)).toBe('260715123045');
        expect(formatYymmddhhmmss(new Date(instant.getTime()))).toBe(
            '260715123045'
        );
    });

    it('DST forward boundary (last Sunday of March): тестуємо момент стрибка', () => {
        // 2026 DST start: last Sunday of March = 29 March 2026 03:00 Kyiv.
        // Перед DST: 28 March 2026 02:30 Kyiv (UTC+2) = UTC 00:30.
        const before = new Date('2026-03-28T00:30:00.000Z');
        expect(formatYymmddhhmmss(before)).toBe('260328023000');
        // Після DST: 29 March 2026 04:30 Kyiv (UTC+3) = UTC 01:30.
        const after = new Date('2026-03-29T01:30:00.000Z');
        expect(formatYymmddhhmmss(after)).toBe('260329043000');
    });
});

describe('getKyivYearMonth (Sprint 4 §4.1, slug-preset prefix)', () => {
    it('повертає 1-indexed month у Kyiv-tz', () => {
        // Травень 15 2026 12:00 Kyiv (DST UTC+3) = UTC 09:00.
        const instant = new Date('2026-05-15T09:00:00.000Z');
        expect(getKyivYearMonth(instant)).toEqual({ year: 2026, month: 5 });
    });

    it('boundary midnight: UTC 31.05 21:30Z = Kyiv 01.06 00:30 → month=6', () => {
        // КРИТИЧНИЙ КЕЙС: інвойс, виставлений 1 червня 00:30 Київ, у UTC ще
        // 31 травня 21:30Z. UTC-логіка дала б місяць = 5 (травень) → slug
        // ламав би monthly-звітність (інвойс червня з prefix-ом 2026-05-).
        const instant = new Date('2026-05-31T21:30:00.000Z');
        expect(getKyivYearMonth(instant)).toEqual({ year: 2026, month: 6 });
    });

    it('boundary year-end: UTC 31.12 22:30Z (winter UTC+2) = Kyiv 01.01 наступного року', () => {
        const instant = new Date('2026-12-31T22:30:00.000Z');
        expect(getKyivYearMonth(instant)).toEqual({ year: 2027, month: 1 });
    });

    it('boundary DST: UTC 31.10 22:30Z (DST closure boundary) — коректно резолвиться', () => {
        // DST end 2026: last Sunday of October = 25 October 2026 04:00 Kyiv → UTC+2.
        // 31 October 22:30Z = Kyiv 01 November 00:30 (after DST end).
        const instant = new Date('2026-10-31T22:30:00.000Z');
        expect(getKyivYearMonth(instant)).toEqual({ year: 2026, month: 11 });
    });

    it('mid-day у DST період', () => {
        // Червень 15 12:00 Kyiv (UTC+3) = UTC 09:00.
        const instant = new Date('2026-06-15T09:00:00.000Z');
        expect(getKyivYearMonth(instant)).toEqual({ year: 2026, month: 6 });
    });

    it('mid-day у standard time (зима)', () => {
        // Лютий 15 12:00 Kyiv (UTC+2) = UTC 10:00.
        const instant = new Date('2026-02-15T10:00:00.000Z');
        expect(getKyivYearMonth(instant)).toEqual({ year: 2026, month: 2 });
    });
});
