'use client';

import { getFullName, getInitials } from '@finly/types';
import { logout } from '@/shared/api';
import { useAuthStore } from '@/entities/user';

/**
 * Акаунт-дані та вихід для `AccountSection`. Logout — best-effort серверний
 * revoke (interceptor пропускає `/auth/logout`-помилки наскрізь), локальний
 * вихід (clearUser + redirect) виконується завжди. Логіка дзеркалить
 * `useUserMenu`, звідки акаунт-частина переїхала при виносі навігації у sidebar.
 */
export function useCabinetAccount() {
    const user = useAuthStore((s) => s.user);
    const clearUser = useAuthStore((s) => s.clearUser);

    const fullName = user
        ? getFullName(user.profile.firstName, user.profile.lastName)
        : '';
    const initials = user ? getInitials(fullName, user.email) : '';

    const handleLogout = () => {
        void (async () => {
            try {
                await logout();
            } catch (error) {
                console.warn('Logout request failed', error);
            }
            clearUser();
            window.location.assign('/');
        })();
    };

    return { user, fullName, initials, handleLogout };
}
