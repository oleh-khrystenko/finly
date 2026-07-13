/**
 * Sprint 19/27 — спільні білінг-локи. Два рівні серіалізації:
 *
 * 1. **Per-user лок** (`billingLockKey`) — серіалізує мутації білінг-стану
 *    одного платника: checkout/cancel/capacity/attach/webhook
 *    (`BillingProfileService.withBillingLock`).
 * 2. **Глобальний reconcile-мьютекс** (`RECONCILE_LOCK_KEY`) — серіалізує
 *    read-then-write реконсиляції `brandedAt`/slug-rent
 *    (`ReconciliationService.reconcileBusinesses`). Per-user лок тут НЕ
 *    достатній: один бізнес може бути у складах кількох платників (тригери
 *    двох різних user-локів реконсилюють той самий бізнес конкурентно), а
 *    daily-sweep (`PaymentsCleanupService`) реконсилює взагалі без user-лока.
 *    Стан читається ВСЕРЕДИНІ секції, тож stale-write неможливий; збіжність
 *    гарантують durable-маркери `reconcileRequiredAt` (кожна мутація має свій
 *    reconcile-тригер, останній у черзі читає найсвіжіший стан).
 *
 * Порядок вкладення завжди user-лок → reconcile-мьютекс (зворотного немає),
 * тож deadlock виключений.
 *
 * TTL — стеля утримання. Бюджет рахуємо за найгіршим шляхом, не happy-path.
 * Sprint 22 (monobank, без рекуренту) звів критичні секції до ОДНОГО зовнішнього
 * провайдер-виклику по REQUEST_TIMEOUT_MS=20s стелі:
 *   - checkout/resume — створення хостованого рахунку (`createInvoice`);
 *   - продовження billing-clock — списання за токеном (`chargeByToken`);
 *   - звірка завислої спроби — запит статусу рахунку (`getInvoiceStatus`).
 * Жодного suspend/resume/remove/change/refund рекуренту (їх знесено), тож двох
 * послідовних провайдер-викликів під локом більше немає. TTL мусить покривати
 * один 20s-виклик плюс Mongo-операції (зокрема webhook-TX) з запасом, інакше лок
 * авто-експайрився б посеред критичної секції саме під час деградації провайдера
 * і mutual-exclusion зникав би; 90s лишає широку маржу. Реконсиляція під цим же
 * локом обмежена батчем (`SLUG_RENT_MAX_RESETS_PER_RUN`), тож не може виїсти TTL
 * необмеженою кількістю slug-reset-ів. Lock авто-звільняється по TTL, якщо процес
 * упав усередині критичної секції.
 */
export const BILLING_LOCK_TTL_MS = 90_000;

const BILLING_LOCK_PREFIX = 'billing_op:';

export function billingLockKey(userId: string): string {
    return `${BILLING_LOCK_PREFIX}${userId}`;
}

/**
 * Глобальний мьютекс реконсиляції `brandedAt`/slug-rent (див. пункт 2 вище).
 * Критична секція — лише Mongo-операції, обмежені батч-лімітом
 * `SLUG_RENT_MAX_RESETS_PER_RUN` (200 коротких TX по одиниці-десятки мс кожна),
 * тож 60s покриває найгірший прогін з широкою маржею. Зайнятий лок — не
 * помилка: caller повертає `false`, durable-маркер тримає retry.
 */
export const RECONCILE_LOCK_KEY = 'billing_reconcile:all';
export const RECONCILE_LOCK_TTL_MS = 60_000;
