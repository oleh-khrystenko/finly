export const INTL_LOCALE = 'uk-UA';

export function formatLocalDate(date: Date | string | null): string {
    if (!date) return '';
    return new Intl.DateTimeFormat(INTL_LOCALE, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    }).format(date instanceof Date ? date : new Date(date));
}

/**
 * UA-плюрал за останньою цифрою (mod-10) + спец-кейс на 11..14 (завжди форма
 * "багато"). 1 → one, 2-4 → few, 5-9/0/11-14 → many. Без `Intl.PluralRules`,
 * бо нам потрібна повноцінна форма "1 рахунок / 2 рахунки / 5 рахунків", а
 * Intl-API повертає лише ключ ('one' / 'few' / 'many'), мапінг ключ→слово
 * лишається на caller-i і дублює нашу таблицю.
 */
export function pluralizeUa(
    count: number,
    one: string,
    few: string,
    many: string
): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 14) return `${count} ${many}`;
    if (mod10 === 1) return `${count} ${one}`;
    if (mod10 >= 2 && mod10 <= 4) return `${count} ${few}`;
    return `${count} ${many}`;
}
