export const THEME = {
    LIGHT: 'light',
    DARK: 'dark',
    SYSTEM: 'system',
} as const;

export type Theme = (typeof THEME)[keyof typeof THEME];

export interface PageParams {
    params: Promise<{ locale: string }>;
}

interface Meta {
    title: string;
    description: string;
}

export interface MetaProps extends PageParams {
    page: string | null;
    href: string;
    meta?: Meta;
}
