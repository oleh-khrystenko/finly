export const INTL_LOCALE = 'uk-UA';

export function formatLocalDate(date: Date | string | null): string {
    if (!date) return '';
    return new Intl.DateTimeFormat(INTL_LOCALE, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    }).format(date instanceof Date ? date : new Date(date));
}
