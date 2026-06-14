/**
 * Sprint 19 — `Cache-Control` для public payment-сторінок бізнесу/рахунку та їх
 * QR-зображень (`pay.finly.com.ua/...`).
 *
 * Сторінка тепер revocable: реконсиляція при втраті доступу стемпить
 * `business.accessBlockedAt`, після чого public-резолв (`getBySlugOrHistorical`)
 * віддає 404 і сторінка/QR гаснуть. Колишній агресивний кеш
 * (`max-age=3600, stale-while-revalidate=86400`) робив гасіння неефективним на
 * CDN-краю: вже закешована 200-відповідь віддавалася б ще до ~25 год після
 * блокування, а `stale-while-revalidate` навмисно дозволяє віддавати застарілий
 * контент під час фонової ревалідації — саме те, чого revocation не терпить.
 *
 * Тому: помірний `max-age` (швидке гасіння — у межах вікна) **без**
 * `stale-while-revalidate` (по спливу `max-age` CDN мусить ревалідувати з origin
 * і отримати 404). Резолв дешевий (single slug-lookup), тож 1 origin-hit на
 * вікно per-сторінка прийнятний. Інвойсна сторінка лишається `no-store`
 * (mutable payment command) і цієї константи не використовує.
 */
export const PUBLIC_PAGE_CACHE_CONTROL = 'public, max-age=300';
