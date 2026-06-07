/**
 * Парс/формат українського формату дати `ДД.ММ.РРРР` ↔ ISO `YYYY-MM-DD`.
 *
 * **Навіщо.** `ValidUntilSection` дозволяє вписати термін дії руками, а не лише
 * обрати в календарі. ISO — спільна мова з `kyivEndOfDayInstant` (приймає
 * `YYYY-MM-DD`) і з нативним `<input type="date">` (його `value`/`onChange`
 * теж ISO). Тож текст у полі тримаємо у звичному для ФОП `ДД.ММ.РРРР`, а на
 * межах конвертуємо в ISO.
 */

/**
 * `ДД.ММ.РРРР` → `YYYY-MM-DD`. Повертає `null` на будь-якому невалідному вході
 * (неповний набір, нечислові, неіснуюча дата на кшталт `31.02.2026`).
 */
export function uaDateToIso(input: string): string | null {
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(input.trim());
    if (!match) return null;
    const [, dd, mm, yyyy] = match;
    const day = Number(dd);
    const month = Number(mm);
    const year = Number(yyyy);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    // Відсіюємо неіснуючі дати (31.02, 30.02 тощо): round-trip через UTC-конструктор
    // нормалізує переповнення, тож розбіжність зі входом = невалідна дата.
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
        probe.getUTCFullYear() !== year ||
        probe.getUTCMonth() !== month - 1 ||
        probe.getUTCDate() !== day
    ) {
        return null;
    }
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * `YYYY-MM-DD` → `ДД.ММ.РРРР`. Повертає `''` на невалідному вході (зокрема
 * порожньому), щоб безпечно сидіти у text-input value.
 */
export function isoToUaDate(iso: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return '';
    const [, yyyy, mm, dd] = match;
    return `${dd}.${mm}.${yyyy}`;
}
