export const LANG = {
    UK: 'uk',
    EN: 'en',
} as const;

export type Lang = (typeof LANG)[keyof typeof LANG];

export const SUPPORTED_LANGS: Lang[] = [LANG.UK, LANG.EN];
export const DEFAULT_LANG: Lang = LANG.EN;
