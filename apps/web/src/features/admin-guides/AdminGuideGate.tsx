'use client';

import { type ReactNode } from 'react';
import { notFound } from 'next/navigation';

import UiFullPageLoader from '@/shared/ui/UiFullPageLoader';
import { useAuthStore } from '@/entities/user';

/**
 * Client role-gate for the admin section. Auth itself is already enforced by
 * the (protected) AuthGuard; this hides the section from non-admins and 404s
 * on direct navigation. It is UX, not security — the real guard is the API
 * AdminGuard, which rejects the endpoints regardless of what the UI renders.
 */
export function AdminGuideGate({ children }: { children: ReactNode }) {
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
