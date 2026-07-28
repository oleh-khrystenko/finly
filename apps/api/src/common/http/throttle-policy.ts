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
    // Sprint 8 §8.1 — anon `POST /qr/preview`. payload-перебір тут потенційно
    // дешевший за full payment-page-hit (нема БД-lookup-у), тож ліміт лишається
    // помірним, але 30/min (не 10) — щоб анонімні користувачі за спільною IP
    // (NAT/CDN), які активно граються з формою, не ловили хибний 429.
    { name: 'qr-preview', ttl: 60000, limit: 30 },
    // Sprint 16 — anon help assistant (`POST /ai/help/chat`). Coarse per-minute
    // burst guard; реальні wallet-cap-и — per-IP 24h limit і global daily budget
    // у `HelpChatRateLimitGuard`.
    { name: 'help-chat', ttl: 60000, limit: 20 },
    // Sprint 21 — живе прев'ю кастомного бренду (`BrandController.preview`,
    // authorized). Окремий бакет, щоб НЕ ділити лічильник з анонімним
    // `qr-preview`: інакше скан з того ж IP (NAT) міг би заблокувати прев'ю
    // платного клієнта і навпаки. Кожен виклик важкий (download + bake + 2
    // рендери), але debounce-флоу легітимно дає кілька запитів поспіль. 60/min —
    // із запасом на активне налаштування бренду за спільною IP.
    { name: 'brand-preview', ttl: 60000, limit: 60 },
    // Sprint 28 — публічний read-only контент гайдів. Споживач — server-side
    // fetch web-у (сторінки, sitemap, OG), тож усі клієнти виглядають одним IP:
    // високий ліміт як у public-payment, окремий бакет щоб не ділити лічильник з
    // платіжною зоною.
    { name: 'public-content', ttl: 60000, limit: 600 },
    // Sprint 29 — персоналізований податковий QR/посилання
    // (`PublicAccountsController` `qr/personalized.png` + `personalized-links`).
    // Анонімний і CPU-важкий (sharp-рендер з підстановкою), а через унікальні
    // query-значення (РНОКПП/період) фактично не кешується на CDN.
    //
    // Ліміт як у `public-payment`, а не нижчий, попри вагу рендеру: запити з
    // браузера платника йдуть на `/api/...` того самого origin і доходять до API
    // через rewrite web-контейнера (див. шапку файлу), тож лічильник спільний на
    // ВСІХ відвідувачів податкових сторінок. Нижчий ліміт був би не «стільки на
    // платника», а «стільки на продукт»: 30/min гасив би головну фічу спринту
    // приблизно з двох десятків платників за хвилину — саме тоді, коли трафік
    // максимальний (податкові дедлайни). Окремий бакет лишається, щоб важкий
    // рендер не ділив лічильник з платіжними сторінками; від спаму різними taxId
    // захищає не цей поріг, а відсутність запису в БД і CPU-дешевий 404 на
    // непідходящих отримувачах.
    { name: 'personalized-qr', ttl: 60000, limit: 600 },
] as const;

export type ThrottlerName = (typeof THROTTLERS)[number]['name'];

/**
 * Per-user ліміти (`@UserRateLimit` + `UserRateLimitGuard`) — другий вимір поруч
 * з IP-бакетами вище. Живуть у цьому ж файлі навмисно: аудит «які ліміти взагалі
 * є у продукті» має читатись з одного місця.
 *
 * Кабінет цілком скіпає IP-бакети (див. шапку файлу: за rewrite web-контейнера
 * всі користувачі мають одну адресу, тож IP-лічильник там спільний на весь
 * продукт). Там, де ліміт усе-таки потрібен, рахуємо по userId.
 */
export const USER_RATE_LIMITS = {
    /**
     * Живий пошук вільного красивого посилання (бізнес / реквізити / рахунок).
     * Ендпоінт без запису, але це оракул «чи вільне ім'я»: без ліміту один
     * обліковий запис перебирає весь простір імен за години. 60/хв з запасом
     * покриває набір з debounce-ом (реальний ввід дає одиниці запитів на ім'я).
     */
    slugAvailability: {
        bucket: 'slug-availability',
        limit: 60,
        windowSec: 60,
    },
} as const;

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
