/**
 * Перевіряє, що `target` — same-origin absolute path (придатний для
 * `router.replace`), а не open-redirect-вектор.
 *
 * Single source of truth для path-safety-rule. Reuse-ається у трьох
 * call-site-ах: Zod-refine на `User.pendingPostLoginTarget`, backend
 * write-helper (`UsersService.setPendingPostLoginTarget`), frontend
 * read-helper (`AuthInitializer`).
 */
export function validateSameOriginPath(target: string): boolean {
    return (
        target.startsWith('/') &&
        !target.startsWith('//') &&
        !/^https?:\/\//i.test(target)
    );
}

/** Origin переданого absolute-URL, або `null` якщо значення не є http(s)-URL. */
function toHttpOrigin(value: string): string | null {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
}

/**
 * Sprint 30 — ціль повернення після входу у режимі спільної сесії двох хостів
 * (кабінет і pay). Приймає рівно два види значень:
 *
 *  - same-origin шлях (`/business/foo`) — чинний режим;
 *  - абсолютну адресу, origin якої збігається з одним із `allowedOrigins`.
 *
 * `allowedOrigins` приходить з конфігурації кожного боку (API — `WEB_URL` і
 * `PAY_PUBLIC_URL`, web — відповідні `NEXT_PUBLIC_*`), тому список хостів не
 * зашитий у спільний пакет і не розходиться між середовищами.
 *
 * Довільний зовнішній домен тут означав би відкритий редірект з довіреного
 * домену після успішного входу, тобто готовий інструмент фішингу — саме тому
 * перевірка порівнює origin цілком (схема + хост + порт), а не суфікс домену:
 * `https://finly.com.ua.evil.net` суфіксну перевірку пройшов би.
 *
 * Зворотний слеш після провідного (`/\evil.com`) браузери трактують як
 * protocol-relative адресу, тож шлях з ним відхиляємо нарівні з `//`.
 */
export function isAllowedReturnTarget(
    target: string,
    allowedOrigins: readonly string[]
): boolean {
    if (target.startsWith('/')) {
        return validateSameOriginPath(target) && !target.startsWith('/\\');
    }
    const origin = toHttpOrigin(target);
    if (origin === null) return false;
    return allowedOrigins.some((allowed) => toHttpOrigin(allowed) === origin);
}
