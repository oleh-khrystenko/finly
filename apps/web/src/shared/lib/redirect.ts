import { isAllowedReturnTarget } from '@finly/types';

import { ENV } from '@/shared/config';

/**
 * **Модуль свідомо НЕ реекспортується з `@/shared/lib`** — імпортувати його
 * треба прямим шляхом (`@/shared/lib/redirect`).
 *
 * Причина: він читає конфігурацію середовища, а завантажувач конфігурації
 * fail-fast (`shared/config/env.ts`) падає на відсутній змінній. Barrel
 * `shared/lib` тягне за собою кожен UI-примітив (усі беруть звідти
 * `composeClasses`), тож реекспорт зробив би звичайну кнопку залежною від
 * повного набору змінних середовища — одна пропущена валила б не сторінку
 * входу, а весь інтерфейс.
 */
const REDIRECT_KEY = 'auth_redirect';

/**
 * Sprint 30 — рівно два наші origin-и: кабінет і публічний pay-хост. Після
 * переїзду сесії на батьківський домен вхід може повертати людину на інший
 * хост, тож повернення перестало бути суто внутрішньою навігацією.
 */
export const RETURN_ORIGINS: readonly string[] = [
    ENV.NEXT_PUBLIC_BASE_URL,
    ENV.NEXT_PUBLIC_PAY_PUBLIC_URL,
];

/**
 * Ціль повернення після входу: свій шлях (`/business/foo`) або абсолютна адреса
 * одного з двох наших хостів. Будь-що інше — відкритий редірект з довіреного
 * домену, тобто готовий інструмент фішингу.
 */
export function isValidRedirect(path: string): boolean {
    return isAllowedReturnTarget(path, RETURN_ORIGINS);
}

export function saveRedirect(path: string): void {
    if (isValidRedirect(path)) sessionStorage.setItem(REDIRECT_KEY, path);
}

export function consumeRedirect(fallback: string): string {
    const saved = sessionStorage.getItem(REDIRECT_KEY);
    sessionStorage.removeItem(REDIRECT_KEY);
    return saved && isValidRedirect(saved) ? saved : fallback;
}

interface AppNavigator {
    push(href: string): void;
    replace(href: string): void;
}

/**
 * Перехід на ціль повернення. Свій шлях іде через роутер (клієнтська
 * навігація), адреса іншого хоста — через `window.location`: роутер Next.js
 * знає лише маршрути свого застосунку, а pay-хост і кабінет — різні документи,
 * навіть якщо їх обслуговує один контейнер.
 *
 * `target` мусить бути вже перевіреним (`isValidRedirect` / `consumeRedirect`).
 */
export function navigateToReturnTarget(
    router: AppNavigator,
    target: string,
    mode: 'push' | 'replace' = 'push'
): void {
    if (target.startsWith('/')) {
        if (mode === 'replace') router.replace(target);
        else router.push(target);
        return;
    }
    if (mode === 'replace') window.location.replace(target);
    else window.location.assign(target);
}
