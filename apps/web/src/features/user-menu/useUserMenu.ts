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
    /**
     * Абсолютна адреса пункту, коли меню живе поза кабінетом (публічний
     * pay-хост). Примітив меню сам рендерить такий пункт посиланням і сам
     * веде на нього, тож `handleSelect` навігацію не дублює.
     */
    href?: string;
    external?: boolean;
}

/**
 * Sprint 30 — меню користувача перестало бути власністю кабінетної шапки: та
 * сама шапка з аватаром і виходом тепер є і на публічних сторінках pay-хоста.
 * Тому хук живе у `features/`, а не всередині widget-а: обидва widget-и
 * (кабінетний header і публічний) споживають його з нижчого шару, замість
 * імпорту одне в одного.
 */
interface UserMenuOptions {
    /**
     * Origin кабінету, коли меню рендериться на іншому хості. Пункти стають
     * абсолютними посиланнями: клік працює як звичайне посилання (нова вкладка,
     * копіювання адреси), бо роутер публічного хоста кабінетних шляхів не знає
     * — `router.push('/business')` дав би там 404.
     */
    cabinetBaseUrl?: string;
    /**
     * Що робити після виходу. Дефолт — на корінь поточного хоста (кабінет).
     * Публічна сторінка передає перезавантаження: людина лишається там, де
     * платила, а введені у форму дані попереднього платника зникають разом зі
     * станом сторінки.
     */
    onLoggedOut?: () => void;
}

export function useUserMenu(
    icons: {
        businesses: ReactNode;
        profile: ReactNode;
        billing: ReactNode;
        logout: ReactNode;
        /** Пункти адмін-розділів (гайди/каталог), лише для ролі admin. */
        adminGuides?: ReactNode;
        adminCatalog?: ReactNode;
    },
    options: UserMenuOptions = {}
) {
    const router = useRouter();
    const pathname = usePathname();
    const user = useAuthStore((s) => s.user);
    const clearUser = useAuthStore((s) => s.clearUser);

    const isAdmin = user?.role === 'admin';
    const { cabinetBaseUrl, onLoggedOut } = options;

    const withHref = (item: UserMenuItem): UserMenuItem =>
        cabinetBaseUrl && item.route
            ? {
                  ...item,
                  href: `${cabinetBaseUrl}${item.route}`,
                  external: true,
              }
            : item;

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
        ...(isAdmin && icons.adminGuides
            ? [
                  {
                      value: 'admin-guides',
                      label: 'Гайди',
                      icon: icons.adminGuides,
                      route: '/admin/guides',
                      badge: 'Адмін',
                  },
              ]
            : []),
        ...(isAdmin && icons.adminCatalog
            ? [
                  {
                      value: 'admin-catalog',
                      label: 'Каталог',
                      icon: icons.adminCatalog,
                      route: '/admin/business',
                      badge: 'Адмін',
                  },
              ]
            : []),
        {
            value: 'logout',
            label: 'Вийти',
            icon: icons.logout,
        },
    ].map(withHref);

    // Ховаємо пункт розділу, в якому вже перебуваємо. На публічному хості
    // порівнювати нема з чим (кабінетних шляхів там не буває), тож фільтр
    // лишається кабінетним.
    const visibleItems = allItems.filter(
        (item) =>
            !item.route ||
            Boolean(cabinetBaseUrl) ||
            !pathname.startsWith(item.route)
    );

    const handleSelect = (value: string, onBeforeNavigate?: () => void) => {
        const item = allItems.find((i) => i.value === value);
        onBeforeNavigate?.();
        // Пункт-посилання веде себе сам (примітив рендерить `<a>`); навігація
        // тут означала б два переходи на один клік.
        if (item?.href) return;
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
                if (onLoggedOut) {
                    onLoggedOut();
                    return;
                }
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
