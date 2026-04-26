'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { CURRENT_TERMS_VERSION } from '@cyanship/types';

import { getMe, refreshToken } from '@/shared/api';
import { useAuthStore } from '@/entities/user';
import { useTermsReacceptDialogStore } from './termsReacceptDialogStore';

// Auth pages that handle their own refresh/verify flow
const SELF_AUTH_PATHS = ['/auth/callback', '/auth/verify', '/auth/reset-password'];

const AuthInitializer = () => {
    const setUser = useAuthStore((s) => s.setUser);
    const clearUser = useAuthStore((s) => s.clearUser);
    const pathname = usePathname();
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
            } catch {
                clearUser();
            }
        };

        void init();
    }, [setUser, clearUser, pathname]);

    return null;
};

export default AuthInitializer;
