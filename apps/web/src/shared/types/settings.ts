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
    /**
     * Override canonical/OG origin. Marketing/help/legal pages default to
     * `NEXT_PUBLIC_BASE_URL`; public payment pages pass `NEXT_PUBLIC_PAY_PUBLIC_URL`.
     */
    baseUrl?: string;
    /**
     * `true` adds `<meta name="robots" content="noindex, nofollow">`. Used
     * for legal pages whose text is in draft state until lawyer review
     * (Sprint 6) — keeps drafts out of search-engine indexes on staging /
     * preview deployments.
     */
    noindex?: boolean;
}
