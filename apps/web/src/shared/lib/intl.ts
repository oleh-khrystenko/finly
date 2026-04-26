const LOCALE_MAP: Record<string, string> = {
    uk: 'uk-UA',
    en: 'en-US',
};

export function toIntlLocale(locale: string): string {
    return LOCALE_MAP[locale] ?? locale;
}

export function formatLocalDate(
    date: Date | string | null,
    locale: string
): string {
    if (!date) return '';
    return new Intl.DateTimeFormat(toIntlLocale(locale), {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    }).format(date instanceof Date ? date : new Date(date));
}
