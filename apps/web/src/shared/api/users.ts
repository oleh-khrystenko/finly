import { apiClient } from './client';

/**
 * Sprint 11 — explicit clear-action для backend-stamped redirect-target.
 * Викликається з двох call-site-ів: verify-page (same-device flow, ДО
 * `router.replace`) і `AuthInitializer` (cold-login flow, ДО redirect-у
 * на stamped target). Backend приймає лише `null` через `UpdateProfileSchema`
 * — non-null value reject-ається як anti-injection rule.
 */
export async function clearPendingPostLoginTarget(): Promise<void> {
    await apiClient.patch('/users/me', { pendingPostLoginTarget: null });
}

/**
 * Sprint 20 — зняти власну активну бронь slug. Викликається у фолбеку поач-у
 * (`useApplyPendingSlug`): добивання наміру впало на `SLUG_TAKEN`, тож мертву
 * бронь треба прибрати, щоб провальне застосування не повторювалось на кожному
 * заході в кабінет до спливу TTL. Idempotent на бекенді.
 */
export async function releaseSlugReservation(): Promise<void> {
    await apiClient.delete('/users/me/slug-reservation');
}

/**
 * Sprint 30 — «не пропонувати заповнити податкові дані». Викликається з
 * податкової сторінки після явної відмови; сервер стемпить дату один раз, тож
 * повторний виклик з іншої вкладки нічого не псує.
 */
export async function dismissTaxProfilePrompt(): Promise<void> {
    await apiClient.post('/users/me/tax-profile-prompt/dismiss');
}
