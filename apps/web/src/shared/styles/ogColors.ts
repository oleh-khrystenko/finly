/**
 * sRGB-літерали для per-article OG-банерів (`app/help/[slug]/opengraph-image`).
 * `next/og` (satori) рендерить у власному рушії, що НЕ читає CSS-змінних теми,
 * тож `var(--primary)` тут неможливий — колір мусить бути літералом.
 *
 * Патерн той самий, що й `themeColors.ts`: платформа-специфічний контекст без
 * доступу до CSS тримає літерали в одному місці під `shared/styles/`, а не
 * розсипаними хардкодами у route-файлі. Банер завжди темний (share-preview не
 * має теми), тому одна палітра, не пара light/dark.
 *
 * Джерело істини лишається `themes.css`; значення нижче — sRGB-наближення
 * брендового зеленого і нейтралів для темного тла банера.
 */
export const OG_COLORS = {
    background: '#0f1f18',
    accent: '#35b07a',
    title: '#f2f5f2',
    muted: '#9fb3a8',
    /** Кутове світіння акценту над тлом (satori inline backgroundImage). */
    glow: 'radial-gradient(circle at 85% 15%, rgba(53,176,122,0.16) 0%, rgba(15,31,24,0) 45%)',
} as const;
