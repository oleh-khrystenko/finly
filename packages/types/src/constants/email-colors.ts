/**
 * Email-кольори — проекція light-теми з themes.css.
 * Назви ключів відповідають CSS-змінним (camelCase).
 * Єдине джерело істини: apps/web/src/shared/styles/themes.css
 */
export const EMAIL_COLORS = {
    background: '#f8f8fa', // --background
    card: '#fbfcfc', // --card
    foreground: '#13161b', // --foreground
    mutedForeground: '#6e7278', // --muted-foreground
    primary: '#00a7a8', // --primary
    primaryForeground: '#ffffff', // --primary-foreground
} as const;
