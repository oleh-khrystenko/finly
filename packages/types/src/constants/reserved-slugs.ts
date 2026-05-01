/**
 * Зарезервовані slug-и на корені публічної зони `pay.finly.com.ua/`.
 *
 * Заборонені для бізнесів, бо колізують з технічними роутами Next.js / API /
 * статикою. Перевірка живе у генераторі slug-а (Sprint 3); тут — single source
 * of truth для backend і frontend.
 *
 * Джерело: `docs/product/qr-decisions.md` §4.3.
 */
export const RESERVED_SLUGS = [
    'qr',
    'api',
    'static',
    '_next',
    '_health',
] as const;

export type ReservedSlug = (typeof RESERVED_SLUGS)[number];
