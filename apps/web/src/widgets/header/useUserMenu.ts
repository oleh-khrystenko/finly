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
    dashboard: ReactNode;
    aiChat: ReactNode;
    profile: ReactNode;
    billing: ReactNode;
    logout: ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const user = useAuthStore((s) => s.user);
    const clearUser = useAuthStore((s) => s.clearUser);

    const formattedExecutions = (user?.executions.balance ?? 0).toLocaleString(
        'en-US',
    );

    const allItems: UserMenuItem[] = [
        {
            value: 'dashboard',
            label: 'Дашборд',
            icon: icons.dashboard,
            route: '/dashboard',
        },
        {
            value: 'ai-chat',
            label: 'AI Чат',
            icon: icons.aiChat,
            route: '/ai-chat',
        },
        {
            value: 'profile',
            label: 'Профіль',
            icon: icons.profile,
            route: '/profile',
        },
        {
            value: 'billing',
            label: 'Білінг',
            icon: icons.billing,
            route: '/billing',
            badge: formattedExecutions,
        },
        {
            value: 'logout',
            label: 'Вийти',
            icon: icons.logout,
        },
    ];

    const visibleItems = allItems.filter(
        (item) => !item.route || !pathname.startsWith(item.route),
    );

    const handleSelect = (value: string, onBeforeNavigate?: () => void) => {
        const item = allItems.find((i) => i.value === value);
        onBeforeNavigate?.();
        if (item?.route) {
            router.push(item.route);
        } else if (value === 'logout') {
            void (async () => {
                await logout();
                clearUser();
                window.location.assign('/');
            })();
        }
    };

    const fullName = user
        ? getFullName(user.profile.firstName, user.profile.lastName)
        : '';
    const initials = user ? getInitials(fullName, user.email) : '';

    return { allItems, visibleItems, handleSelect, initials };
}
