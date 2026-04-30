export const THEME = {
    LIGHT: 'light',
    DARK: 'dark',
    SYSTEM: 'system',
} as const;

export type Theme = (typeof THEME)[keyof typeof THEME];

interface Meta {
    title: string;
    description: string;
}

export interface MetaProps {
    page: string | null;
    href: string;
    meta?: Meta;
}
