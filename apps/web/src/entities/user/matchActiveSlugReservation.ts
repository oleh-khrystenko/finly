import type { SlugEntityType, SlugReservationView } from '@finly/types';

interface SlugReservationTarget {
    entityType: SlugEntityType;
    businessSlug: string;
    accountSlug?: string;
    invoiceSlug?: string;
}

/**
 * Sprint 20 — чи стосується активна бронь саме цієї сутності (за типом і
 * канонічним шляхом на момент броні). Повертає бажане ім'я для застосування або
 * null. Порівняння case-insensitive (slug lookup на бекенді теж).
 *
 * Чиста функція в окремому модулі (без імпорту `@/shared/api`), щоб тести
 * матчингу не тягнули env-залежний API-клієнт.
 */
export function matchActiveSlugReservation(
    reservation: SlugReservationView | null | undefined,
    target: SlugReservationTarget
): string | null {
    if (!reservation || reservation.entityType !== target.entityType) {
        return null;
    }
    const eq = (a: string | null, b: string | undefined) =>
        (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
    if (!eq(reservation.businessSlug, target.businessSlug)) return null;
    if (target.entityType === 'account' || target.entityType === 'invoice') {
        if (!eq(reservation.accountSlug, target.accountSlug)) return null;
    }
    if (target.entityType === 'invoice') {
        if (!eq(reservation.invoiceSlug, target.invoiceSlug)) return null;
    }
    return reservation.desiredSlug;
}
