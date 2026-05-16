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
