import { type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getFullName, getInitials } from '@finly/types';
import { logout } from '@/shared/api';
import { useAuthStore } from '@/entities/user';

interface UserMenuItem {
    value: string;
    label: string;
    icon: ReactNode;
    route?: string;
    badge?: string;
}

export function useUserMenu(icons: {
    businesses: ReactNode;
    profile: ReactNode;
    billing: ReactNode;
    logout: ReactNode;
    /** Sprint 28 — пункт адмін-розділу гайдів, лише для ролі admin. */
    admin?: ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const user = useAuthStore((s) => s.user);
    const clearUser = useAuthStore((s) => s.clearUser);

    const isAdmin = user?.role === 'admin';

    const allItems: UserMenuItem[] = [
        {
            // Sprint 3 рішення E2 — `Dashboard` замінено на `Бізнеси` з
            // route `/business` (список бізнесів §3.6). Раніше dashboard
            // був порожньою заглушкою; реальна аналітика повернеться як
            // окрема `/analytics` сторінка, не через відновлення dashboard.
            value: 'businesses',
            label: 'Отримувачі',
            icon: icons.businesses,
            route: '/business',
        },
        {
            value: 'profile',
            label: 'Профіль',
            icon: icons.profile,
            route: '/profile',
        },
        {
            value: 'billing',
            label: 'Тариф',
            icon: icons.billing,
            route: '/billing',
        },
        ...(isAdmin && icons.admin
            ? [
                  {
                      value: 'admin-guides',
                      label: 'Гайди',
                      icon: icons.admin,
                      route: '/admin/guides',
                  },
              ]
            : []),
        {
            value: 'logout',
            label: 'Вийти',
            icon: icons.logout,
        },
    ];

    const visibleItems = allItems.filter(
        (item) => !item.route || !pathname.startsWith(item.route)
    );

    const handleSelect = (value: string, onBeforeNavigate?: () => void) => {
        const item = allItems.find((i) => i.value === value);
        onBeforeNavigate?.();
        if (item?.route) {
            router.push(item.route);
        } else if (value === 'logout') {
            void (async () => {
                // Server-side revoke — best-effort: interceptor пропускає
                // `/auth/logout`-помилки наскрізь, і без catch користувач
                // лишався б «не вийшов» без жодної реакції. Локальний вихід
                // (clearUser + redirect) виконується завжди; невідкликаний
                // refresh-token доживе до TTL або ротації.
                try {
                    await logout();
                } catch (error) {
                    console.warn('Logout request failed', error);
                }
                clearUser();
                window.location.assign('/');
            })();
        }
    };

    const fullName = user
        ? getFullName(user.profile.firstName, user.profile.lastName)
        : '';
    const initials = user ? getInitials(fullName, user.email) : '';

    return {
        allItems,
        visibleItems,
        handleSelect,
        initials,
    };
}
