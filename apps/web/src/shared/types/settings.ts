export const THEME = {
    LIGHT: 'light',
    DARK: 'dark',
    SYSTEM: 'system',
} as const;

export type Theme = (typeof THEME)[keyof typeof THEME];

interface Meta {
    title: string;
    description: string;
    /**
     * Social-share overrides. Defaults to `title`/`description` when absent.
     * Use to drop the `| Finly` brand suffix from `og:title` (OG already
     * carries `siteName: 'Finly'`, so the suffix duplicates the brand in the
     * preview) and to give a livelier, longer hook than the search snippet.
     */
    ogTitle?: string;
    ogDescription?: string;
    /**
     * Controls the OG/Twitter share image. Absent → the shared og-banner.png.
     * `null` → emit no `images`, so a route-level `opengraph-image` file
     * convention supplies a per-page banner (help articles, Sprint 24).
     */
    ogImage?: string | null;
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
