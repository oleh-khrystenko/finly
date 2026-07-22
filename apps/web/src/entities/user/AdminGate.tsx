'use client';

import { type ReactNode } from 'react';
import { notFound } from 'next/navigation';

import UiFullPageLoader from '@/shared/ui/UiFullPageLoader';
import { useAuthStore } from './authStore';

/**
 * Sprint 29 — role-gate для адмін-розділів. Auth уже забезпечує (protected)
 * AuthGuard; цей gate ховає розділ від не-адмінів і 404-ить при прямому заході.
 * Це UX, не безпека: справжній guard — API AdminGuard, який відхиляє ендпоінти
 * незалежно від того, що рендерить UI.
 *
 * Живе в `entities/user`, бо гейт читає роль поточного користувача і потрібен
 * кільком незалежним адмін-розділам (`/admin/guides`, `/admin/payees`,
 * `/admin/publicity`). Тримати його всередині однієї feature означало б, що
 * сусідні розділи імпортують чужий slice.
 */
export function AdminGate({ children }: { children: ReactNode }) {
    const user = useAuthStore((s) => s.user);
    const isLoading = useAuthStore((s) => s.isLoading);

    if (isLoading) {
        return <UiFullPageLoader message="Завантаження..." />;
    }

    if (user?.role !== 'admin') {
        notFound();
    }

    return <>{children}</>;
}
