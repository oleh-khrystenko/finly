/**
 * Реєстр named-throttler-ів і політика скіпу для роутів з власним бакетом.
 *
 * **Чому реєстр живе тут, а не в `AppModule`.** `ThrottlerGuard` проганяє КОЖЕН
 * зареєстрований бакет на кожному роуті, а `@SkipThrottle` резолвиться по імені.
 * Тому `@SkipThrottle({ default: true })` гасить лише `default`, і ефективний
 * ліміт роуту дорівнює МІНІМУМУ серед решти активних бакетів: публічна платіжна
 * сторінка з оголошеними 600/хв реально впиралася у `qr-preview` 10/хв. На
 * public-зоні це гостро, бо сторінки тягне Next server-side через
 * `API_INTERNAL_URL` без `X-Forwarded-For`, тобто всі відвідувачі і краулери
 * приходять з одного IP контейнера.
 *
 * `skipThrottlersExcept` рахує скіп-мапу від повного реєстру, тож новий бакет не
 * може тихо затінити наявний роут: він потрапляє у скіп автоматично. Ручні
 * скіп-списки на роутах заборонені саме тому, що дрейфують від реєстру.
 */

export const THROTTLERS = [
    // Дефолтний — cabinet/auth/AI/storage/payments (60 req/min на IP як guard
    // від abuse).
    { name: 'default', ttl: 60000, limit: 60 },
    // Public-payment endpoints (`PublicBusinessesController`,
    // `PublicInvoicesController`): за NAT/CDN/Next-server-proxy багато різних
    // клієнтів виглядають для API як один IP, і дефолтний 60/min блокує реальні
    // платежі (сторінка робить >=3 виклики: JSON view + 2 QR PNG; миттєвий шквал
    // 20 клієнтів вичерпує budget). Захист зберігається — limit просто вищий під
    // специфіку зони.
    { name: 'public-payment', ttl: 60000, limit: 600 },
    // Sprint 8 §8.1 — anon `POST /qr/preview`. Restrictive за дизайном:
    // payload-перебір тут потенційно дешевший за full payment-page-hit (нема
    // БД-lookup-у), і легітимний UX (анонім заповнює форму один раз) вкладається
    // в 10/min навіть з NAT-агрегацією.
    { name: 'qr-preview', ttl: 60000, limit: 10 },
    // Sprint 16 — anon help assistant (`POST /ai/help/chat`). Coarse per-minute
    // burst guard; реальні wallet-cap-и — per-IP 24h limit і global daily budget
    // у `HelpChatRateLimitGuard`.
    { name: 'help-chat', ttl: 60000, limit: 20 },
    // Sprint 20 — live-перевірка доступності slug (authorized, усі рівні).
    // Користувач друкує ім'я і запити йдуть debounce-ом: 30/min/IP вистачає на
    // нормальний ввід, але стримує перебір.
    { name: 'slug-availability', ttl: 60000, limit: 30 },
    // Sprint 21 — живе прев'ю кастомного бренду (`BrandController.preview`,
    // authorized). Окремий бакет, щоб НЕ ділити лічильник з анонімним
    // `qr-preview`: інакше скан з того ж IP (NAT) міг би заблокувати прев'ю
    // платного клієнта і навпаки. Кожен виклик важкий (download + bake + 2
    // рендери), але debounce-флоу легітимно дає кілька запитів поспіль.
    { name: 'brand-preview', ttl: 60000, limit: 20 },
    // Sprint 28 — публічний read-only контент гайдів. Споживач — server-side
    // fetch web-у (сторінки, sitemap, OG), тож усі клієнти виглядають одним IP:
    // високий ліміт як у public-payment, окремий бакет щоб не ділити лічильник з
    // платіжною зоною.
    { name: 'public-content', ttl: 60000, limit: 600 },
    // Sprint 29 — персоналізований податковий QR/посилання
    // (`PublicAccountsController` `qr/personalized.png` + `personalized-links`).
    // Анонімний і CPU-важкий (sharp-рендер з підстановкою), а через унікальні
    // query-значення (РНОКПП/період) фактично не кешується на CDN. Свідомо
    // НИЖЧИЙ за `public-payment`: легітимний платник заповнює форму один раз і
    // генерує кілька разів, тож 30/min вистачає, але спам різними taxId
    // стримується.
    { name: 'personalized-qr', ttl: 60000, limit: 30 },
] as const;

export type ThrottlerName = (typeof THROTTLERS)[number]['name'];

/**
 * Скіп усіх бакетів, окрім переданих. Використання на контролері/роуті, що
 * оголошує власний `@Throttle({ '<bucket>': ... })`:
 *
 *   `@SkipThrottle(skipThrottlersExcept('public-payment'))`
 */
export function skipThrottlersExcept(
    ...keep: ThrottlerName[]
): Record<ThrottlerName, boolean> {
    const kept = new Set<ThrottlerName>(keep);
    return Object.fromEntries(
        THROTTLERS.map(({ name }) => [name, !kept.has(name)])
    ) as Record<ThrottlerName, boolean>;
}
