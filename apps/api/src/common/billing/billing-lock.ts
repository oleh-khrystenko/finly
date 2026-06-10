/**
 * Sprint 19 — спільний per-user білінг-лок. Один ключ серіалізує ВСІ операції,
 * що мутують білінг-стан або похідний від нього `accessBlockedAt`/slug-rent:
 * checkout/cancel/change-plan/webhook (`PaymentsService.withBillingLock`) і
 * реконсиляцію бізнесів (`ReconciliationService.reconcileUnderLock`). Ключ
 * винесено сюди, щоб обидва модулі гарантовано ділили той самий мьютекс —
 * розбіжні префікси означали б lost-update на `accessBlockedAt` між cron-ом
 * і grant-вебхуком того ж користувача.
 *
 * TTL — стеля утримання. Найдовша операція (changePlan upgrade) робить
 * послідовно proration-Charge + CHANGE, кожен до REQUEST_TIMEOUT_MS=20s.
 * Реконсиляція під цим же локом обмежена батчем
 * (`SLUG_RENT_MAX_RESETS_PER_RUN`), тож не може виїсти TTL необмеженою
 * кількістю slug-reset-ів. Lock авто-звільняється по TTL, якщо процес упав
 * усередині критичної секції.
 */
export const BILLING_LOCK_TTL_MS = 60_000;

const BILLING_LOCK_PREFIX = 'billing_op:';

export function billingLockKey(userId: string): string {
    return `${BILLING_LOCK_PREFIX}${userId}`;
}
