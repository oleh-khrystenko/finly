'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CURRENT_TERMS_VERSION, validateSameOriginPath } from '@finly/types';

import {
    clearPendingPostLoginTarget,
    getMe,
    refreshToken,
} from '@/shared/api';
import { useAuthStore } from '@/entities/user';
import { useTermsReacceptDialogStore } from './termsReacceptDialogStore';

// Auth pages that handle their own refresh/verify flow
const SELF_AUTH_PATHS = [
    '/auth/callback',
    '/auth/verify',
    '/auth/reset-password',
];

const AuthInitializer = () => {
    const setUser = useAuthStore((s) => s.setUser);
    const clearUser = useAuthStore((s) => s.clearUser);
    const pathname = usePathname();
    const router = useRouter();
    const triedRef = useRef(false);

    useEffect(() => {
        if (triedRef.current) return;
        triedRef.current = true;

        const isSelfAuthRoute = SELF_AUTH_PATHS.some((p) =>
            pathname.includes(p)
        );

        if (isSelfAuthRoute) {
            clearUser();
            return;
        }

        const init = async () => {
            try {
                await refreshToken();
                const user = await getMe();
                setUser(user);

                if (user.termsVersion !== CURRENT_TERMS_VERSION) {
                    useTermsReacceptDialogStore.getState().open();
                }

                // Sprint 11 — cold-login resume на backend-stamped target.
                // Same-device flow вже clear-ить stamp у verify-page-handler;
                // тут ловимо лише cold-login (юзер закрив таб mid-redirect
                // у попередній сесії). Order "clear-before-redirect"
                // критичний: clear гарантує one-time-use semantic — навіть
                // якщо юзер прерве redirect знову, наступна сесія не
                // спрацює на stale stamp.
                const target = user.pendingPostLoginTarget;
                if (!target) return;

                if (!validateSameOriginPath(target)) {
                    // Defense-in-depth: backend-side validation на write вже
                    // мала це не пропустити. Цей ловить XSS-state-injection
                    // або прямий БД-edit на staging.
                    console.warn(
                        '[AuthInitializer] invalid pendingPostLoginTarget; skipping redirect',
                        target
                    );
                    try {
                        await clearPendingPostLoginTarget();
                    } catch (err) {
                        console.warn(
                            '[AuthInitializer] failed to clear invalid pendingPostLoginTarget',
                            err
                        );
                    }
                    return;
                }

                try {
                    await clearPendingPostLoginTarget();
                } catch (err) {
                    console.warn(
                        '[AuthInitializer] failed to clear pendingPostLoginTarget',
                        err
                    );
                }
                router.replace(target);
            } catch {
                clearUser();
            }
        };

        void init();
    }, [setUser, clearUser, pathname, router]);

    return null;
};

export default AuthInitializer;
