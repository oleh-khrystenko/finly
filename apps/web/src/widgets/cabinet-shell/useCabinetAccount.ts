'use client';

import { getFullName, getInitials } from '@finly/types';
import { performLogout, useAuthStore } from '@/entities/user';

/**
 * Акаунт-дані та вихід для `AccountSection`. Сам вихід — спільний
 * `performLogout` з `entities/user`: послідовність revoke → clearUser →
 * перезавантаження однакова для всіх точок виходу.
 */
export function useCabinetAccount() {
    const user = useAuthStore((s) => s.user);

    const fullName = user
        ? getFullName(user.profile.firstName, user.profile.lastName)
        : '';
    const initials = user ? getInitials(fullName, user.email) : '';

    const handleLogout = () => {
        void performLogout();
    };

    return { user, fullName, initials, handleLogout };
}
