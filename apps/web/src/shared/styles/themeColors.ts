/**
 * sRGB-проєкція фон-токена `--background` з `themes.css` для контекстів, куди
 * не можна підставити CSS-змінну: `viewport.themeColor` (tint браузерного хрому)
 * і web-манифест (`background_color` / `theme_color`). Платформа читає ці
 * значення до застосування CSS, тож `var(--background)` тут неможливий — колір
 * мусить бути літералом.
 *
 * Джерело істини лишається `themes.css`. Значення нижче — точний sRGB тих самих
 * oklch (перевірено конвертацією oklch → sRGB):
 *   light  `:root --background`  oklch(0.975 0.005 85)  →  #f8f7f3
 *   dark   `.dark --background`  oklch(0.18  0.012 65)  →  #15110c
 *
 * Правлячи фон у `themes.css`, онови і ці два літерали — тут, в одному місці,
 * а не в розсипаних по метаданих хардкодах.
 */
export const THEME_BACKGROUND = {
    light: '#f8f7f3',
    dark: '#15110c',
} as const;
