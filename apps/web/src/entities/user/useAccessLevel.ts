import { isAccessLevelAtLeast, type AccessLevel } from '@finly/types';

import { useAuthStore } from './authStore';

/**
 * Sprint 19 — поточний рівень доступу користувача (`none < brand < bookkeeper`),
 * похідний з білінг-стану (`billing.accessLevel`, обчислений на API через
 * `deriveAccessLevel`). Без білінгу — `none`. Єдине джерело для web-гейтингу
 * (locked slug-поля, upsell).
 */
export function useAccessLevel(): AccessLevel {
    return useAuthStore((s) => s.user?.billing?.accessLevel ?? 'none');
}

/** Чи може користувач редагувати vanity-slug (рівень не нижче brand). */
export function useCanEditSlug(): boolean {
    return isAccessLevelAtLeast(useAccessLevel(), 'brand');
}
