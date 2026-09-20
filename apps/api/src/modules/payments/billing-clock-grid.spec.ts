import { CronExpression } from '@nestjs/schedule';

import { BILLING_DUNNING } from '../../config/billing.config';
import {
    BILLING_CLOCK_CRON,
    alignToClockTick,
    tickMsFromCron,
} from './billing-clock-grid';

const HOUR_MS = 60 * 60 * 1000;

describe('billing-clock-grid — вирівнювання на тик', () => {
    it('час усередині години опускається на її початок', () => {
        const aligned = alignToClockTick(new Date('2026-09-20T17:03:41.512Z'));
        expect(aligned.toISOString()).toBe('2026-09-20T17:00:00.000Z');
    });

    it('час рівно на тику не рухається', () => {
        const tick = new Date('2026-09-20T17:00:00.000Z');
        expect(alignToClockTick(tick).getTime()).toBe(tick.getTime());
    });
});

/**
 * Регресія на дрейф прострочки: кожна спроба стартує на тику клока, витрачає
 * секунди на обробку і планує наступну через `retryIntervalHours`. Без
 * вирівнювання цей час лягав би поза сіткою і тик своєї години його не брав —
 * спроба з'їжджала б на годину вперед, а за всі спроби набігало б пів доби.
 */
describe('billing-clock-grid — розклад прострочки не дрейфує', () => {
    const PROCESSING_MS = 3_200;
    const intervalMs = BILLING_DUNNING.retryIntervalHours * HOUR_MS;

    /** Найближчий тик, на якому клок побачить `dueAt` як настале. */
    const tickThatPicksUp = (dueAt: number): number =>
        Math.ceil(dueAt / HOUR_MS) * HOUR_MS;

    it('усі спроби припадають на ту саму годину доби', () => {
        const ticks: number[] = [
            new Date('2026-09-20T17:00:00.000Z').getTime(),
        ];

        while (ticks.length < BILLING_DUNNING.maxAttempts) {
            const last = ticks[ticks.length - 1];
            const nextRetryAt = alignToClockTick(
                new Date(last + PROCESSING_MS + intervalMs)
            );
            ticks.push(tickThatPicksUp(nextRetryAt.getTime()));
        }

        const hours = ticks.map((t) => new Date(t).getUTCHours());
        expect(new Set(hours)).toEqual(new Set([17]));
        // Вікно прострочки лишається тим, що обіцяє конфіг: від першої спроби
        // до останньої — (спроби − 1) × інтервал.
        expect(ticks[ticks.length - 1] - ticks[0]).toBe(
            (BILLING_DUNNING.maxAttempts - 1) * intervalMs
        );
    });

    it('без вирівнювання та сама послідовність зсувалась би щоразу на годину', () => {
        let tick = new Date('2026-09-20T17:00:00.000Z').getTime();
        const hours: number[] = [];

        for (let attempt = 1; attempt <= 3; attempt++) {
            hours.push(new Date(tick).getUTCHours());
            tick = tickThatPicksUp(tick + PROCESSING_MS + intervalMs);
        }

        expect(hours).toEqual([17, 18, 19]);
    });
});

/**
 * Крок сітки береться з самого розкладу, тож зміна розкладу або переводить
 * вирівнювання на новий крок, або падає на імпорті — мовчки розійтись вони не
 * можуть.
 */
describe('billing-clock-grid — крок береться з розкладу', () => {
    it('поточний розклад клока дає годинний крок', () => {
        expect(tickMsFromCron(BILLING_CLOCK_CRON)).toBe(HOUR_MS);
    });

    it('хвилинний розклад дає свій крок', () => {
        expect(tickMsFromCron(CronExpression.EVERY_30_MINUTES)).toBe(
            30 * 60 * 1000
        );
        expect(tickMsFromCron(CronExpression.EVERY_5_MINUTES)).toBe(
            5 * 60 * 1000
        );
    });

    it('щохвилинний розклад приймається обома записами', () => {
        expect(tickMsFromCron(CronExpression.EVERY_MINUTE)).toBe(60 * 1000);
        expect(tickMsFromCron('* * * * *')).toBe(60 * 1000);
    });

    it.each([
        ['раз на добу', CronExpression.EVERY_DAY_AT_MIDNIGHT],
        ['раз на дві години', CronExpression.EVERY_2_HOURS],
        ['по понеділках', '0 0 * * 1'],
        ['крок, що не ділить годину', '0 */7 * * * *'],
        ['не на нульовій секунді', '30 * * * * *'],
    ])('розклад «%s» не приймається', (_label, expression) => {
        expect(() => tickMsFromCron(expression)).toThrow(/BILLING_CLOCK_CRON/);
    });
});
