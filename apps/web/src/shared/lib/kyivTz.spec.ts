import { kyivEndOfDayInstant } from './kyivTz';

/**
 * Sprint 4 SP-7 — критичний тест: незалежно від tz, у якій виконується JS-
 * runtime, результат `kyivEndOfDayInstant` повинен у Europe/Kyiv
 * показувати 23:59:59.
 */

const fmtKyiv = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
});

function asKyivString(d: Date): string {
    const parts = fmtKyiv.formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    const h = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}-${get('month')}-${get('day')} ${h}:${get('minute')}:${get('second')}`;
}

describe('kyivEndOfDayInstant', () => {
    it('зимовий час (EET, UTC+2): 2026-01-15 → 21:59:59Z', () => {
        const d = kyivEndOfDayInstant('2026-01-15');
        expect(asKyivString(d)).toBe('2026-01-15 23:59:59');
        expect(d.toISOString()).toBe('2026-01-15T21:59:59.000Z');
    });

    it('літній час (EEST, UTC+3): 2026-07-10 → 20:59:59Z', () => {
        const d = kyivEndOfDayInstant('2026-07-10');
        expect(asKyivString(d)).toBe('2026-07-10 23:59:59');
        expect(d.toISOString()).toBe('2026-07-10T20:59:59.000Z');
    });

    it('boundary spring DST (зима → літо, кінець березня)', () => {
        // 2026-03-29 — DST у EU зазвичай о 03:00 локально (Kyiv) → +1.
        // 23:59:59 Kyiv після transition вже у літньому часі (UTC+3).
        const d = kyivEndOfDayInstant('2026-03-29');
        expect(asKyivString(d)).toBe('2026-03-29 23:59:59');
    });

    it('boundary fall DST (літо → зима, кінець жовтня)', () => {
        const d = kyivEndOfDayInstant('2026-10-25');
        expect(asKyivString(d)).toBe('2026-10-25 23:59:59');
    });

    it('кидає на невалідному форматі', () => {
        expect(() => kyivEndOfDayInstant('15.01.2026')).toThrow(RangeError);
        expect(() => kyivEndOfDayInstant('2026-1-1')).toThrow(RangeError);
        expect(() => kyivEndOfDayInstant('')).toThrow(RangeError);
    });

    it('не залежить від поточного часу JS-runtime', () => {
        // Незалежно від tz, на якому крутиться Jest, результат стабільний.
        const d1 = kyivEndOfDayInstant('2026-05-07');
        expect(asKyivString(d1)).toBe('2026-05-07 23:59:59');
    });
});
