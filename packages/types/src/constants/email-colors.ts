/**
 * Email-кольори — проекція light-теми з themes.css.
 * Назви ключів відповідають CSS-змінним (camelCase).
 * Єдине джерело істини: apps/web/src/shared/styles/themes.css
 */
export const EMAIL_COLORS = {
    background: '#F8F7F3', // --background
    card: '#FEFDFB', // --card
    foreground: '#1C140D', // --foreground
    mutedForeground: '#645C55', // --muted-foreground
    primary: '#00733E', // --primary
    primaryForeground: '#FBFAF7', // --primary-foreground
    border: '#DAD7D0', // --border
} as const;
