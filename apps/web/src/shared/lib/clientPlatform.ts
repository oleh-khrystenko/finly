/** Клієнтська платформа для вибору способу відкриття банк-додатку. */
export type ClientPlatform = 'ios' | 'android' | 'desktop';

/**
 * Детект платформи з `navigator.userAgent`. Викликається **лише у браузері**
 * (event-handler / effect) — на сервері повертає `'desktop'` (немає
 * `navigator`), тож не може спричинити SSR-mismatch, якщо не рендериться
 * умовно за результатом.
 *
 * iPadOS 13+ за замовчуванням маскується під macOS Safari (desktop UA), тож
 * розрізняємо його за `maxTouchPoints` — інакше iPad не отримав би iOS-схему.
 */
export function detectClientPlatform(): ClientPlatform {
    if (typeof navigator === 'undefined') return 'desktop';

    const ua = navigator.userAgent.toLowerCase();

    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    // iPadOS, що видає себе за Mac: desktop-UA + наявність тач-екрану.
    if (ua.includes('macintosh') && navigator.maxTouchPoints > 1) return 'ios';
    if (ua.includes('android')) return 'android';

    return 'desktop';
}
