'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useAuthStore } from '@/entities/user';

const SESSION_EXPIRED_REASON = 'session-expired';

/**
 * Reacts to a server-driven "session expired" redirect.
 *
 * Closes the loop between the server middleware (which redirects to
 * /auth/signin when a protected route is accessed without a valid
 * `bid_refresh` cookie) and the client store (which still holds the
 * previous user object in memory).
 *
 * Without this handler, the user lands on /auth/signin with the header
 * still showing their old avatar/email — two sources of truth diverge.
 * The middleware tags genuine session-expiration redirects with
 * `?reason=session-expired`; this component reads that signal, clears
 * the in-memory user, and surfaces a one-shot toast so the user
 * understands what happened.
 *
 * Why query param (not pathname): we cannot tell "user voluntarily
 * navigated to /auth/signin" from "server redirected here because the
 * session is dead" by looking at the URL alone. The query param is the
 * server's explicit signal — eliminates false positives where a logged-in
 * user typing /auth/signin manually would otherwise be silently logged out.
 *
 * The param is consumed exactly once per mount, then stripped from the
 * URL via `router.replace()` so a refresh does not re-trigger the toast.
 * Other query params (`redirect`, `email`, `step`) are preserved.
 */
export default function SessionExpiredHandler() {
    const t = useTranslations('auth_page.signin');
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const handledRef = useRef(false);

    useEffect(() => {
        if (handledRef.current) return;

        const reason = searchParams.get('reason');
        if (reason !== SESSION_EXPIRED_REASON) return;

        handledRef.current = true;

        useAuthStore.getState().clearUser();
        toast.info(t('session_expired'));

        // Strip ?reason from the URL so refresh/back navigation does
        // not re-fire the toast. Preserve every other query param.
        const remaining = new URLSearchParams(searchParams.toString());
        remaining.delete('reason');
        const queryString = remaining.toString();
        router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
            scroll: false,
        });
    }, [pathname, searchParams, router, t]);

    return null;
}
