import { isoToUaDate, kyivEndOfDayInstant, uaDateToIso } from '@/shared/lib';

/**
 * Модель редагування «Терміну дії» — single source of truth для create-форми
 * (`CreateInvoiceForm`) та inline-edit (`ValidUntilSection`). Тримаємо raw-текст
 * `ДД.ММ.РРРР`, бо ручний ввід проходить multi-stage state (частковий набір ↔
 * валідний ISO ↔ format-error), який `Date | null` не вміє представити —
 * порожній/невалідний текст тихо ставав би `null` («без терміну»), тобто silent
 * data-loss. Чисті helpers нижче інкапсулюють Kyiv-tz семантику (SP-7), щоб
 * обидві сторони поводилися ідентично.
 */

export type ValidUntilMode = 'none' | 'date';

export interface ValidUntilDraft {
    mode: ValidUntilMode;
    /** Raw текст `ДД.ММ.РРРР`; значущий лише коли `mode === 'date'`. */
    raw: string;
}

export const EMPTY_VALID_UNTIL_DRAFT: ValidUntilDraft = { mode: 'none', raw: '' };

/**
 * `Date` → `YYYY-MM-DD` у Europe/Kyiv tz. `getFullYear/Month/Date` дали б
 * browser-local значення — для `validUntil`, створеного у Kyiv-tz (літо UTC+3),
 * браузер у UTC+0 показав би день раніше. Через Intl-formatter тримаємо одну
 * «правду» для всіх клієнтів, щоб edit-mode стартував з правильного дня.
 */
const KYIV_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

function kyivIsoDate(d: Date): string {
    // `en-CA` дає вже `YYYY-MM-DD`.
    return KYIV_DATE_FORMATTER.format(new Date(d));
}

/** `YYYY-MM-DD` «завтра» з точки зору Києва (не браузера). */
export function kyivTomorrowIsoDate(): string {
    const todayKyiv = kyivIsoDate(new Date());
    const [y, m, d] = todayKyiv.split('-').map(Number);
    // `Date.UTC` + 1 день, потім назад у Kyiv-формат — DST-safe, бо ми не
    // міксуємо часові зони, лише day-arithmetic у UTC.
    const tomorrowUtc = new Date(Date.UTC(y, m - 1, d + 1));
    return kyivIsoDate(tomorrowUtc);
}

/** Seed draft з наявного значення (read → edit). */
export function draftFromValue(value: Date | null): ValidUntilDraft {
    if (value === null) return { mode: 'none', raw: '' };
    return { mode: 'date', raw: isoToUaDate(kyivIsoDate(value)) };
}

/** Draft валідний, коли «без терміну» або дата парситься. */
export function isValidUntilDraftValid(draft: ValidUntilDraft): boolean {
    return draft.mode === 'none' || uaDateToIso(draft.raw) !== null;
}

/**
 * Резолвить draft у фінальне значення + прапорець валідності. Невалідний
 * date-draft НЕ перетворюється тихо на `null` — повертає `valid: false`, щоб
 * виклична сторона заблокувала submit/save (інакше silent data-loss). SP-7 —
 * фіксуємо 23:59:59 у Kyiv tz.
 */
export function resolveValidUntil(draft: ValidUntilDraft): {
    value: Date | null;
    valid: boolean;
} {
    if (draft.mode === 'none') return { value: null, valid: true };
    const iso = uaDateToIso(draft.raw);
    if (iso === null) return { value: null, valid: false };
    return { value: kyivEndOfDayInstant(iso), valid: true };
}
