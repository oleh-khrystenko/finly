import { type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { getFullName, getInitials } from '@finly/types';
import { logout, updateProfile } from '@/shared/api';
import { getApiMessage } from '@/shared/api/mapApiCode';
import { useAuthStore } from '@/entities/user';

interface UserMenuItem {
    value: string;
    label: string;
    icon: ReactNode;
    route?: string;
    badge?: string;
}

/**
 * Sprint 3 §3.5 — toggle "Режим бухгалтера" (рішення E5).
 *
 * Відокремлений від `visibleItems` навмисно — він не є нав-лінком (роут
 * не існує) і має іншу UI (`UiSwitch` + inline-опис), що не вкладається у
 * стандартний `UiDropdownMenuItem` shape. Header.tsx і MobileMenuSheet.tsx
 * рендерять окрему секцію між user-card і items.
 */
export interface BookkeeperToggle {
    checked: boolean;
    label: string;
    description: string;
    /** Optimistic update + rollback on error через існуючий mapApiCode toast. */
    onToggle: () => Promise<void>;
}

export function useUserMenu(icons: {
    businesses: ReactNode;
    aiChat: ReactNode;
    profile: ReactNode;
    billing: ReactNode;
    logout: ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const user = useAuthStore((s) => s.user);
    const setUser = useAuthStore((s) => s.setUser);
    const clearUser = useAuthStore((s) => s.clearUser);

    const formattedExecutions = (user?.executions.balance ?? 0).toLocaleString(
        'en-US'
    );

    const allItems: UserMenuItem[] = [
        {
            // Sprint 3 рішення E2 — `Dashboard` замінено на `Бізнеси` з
            // route `/business` (список бізнесів §3.6). Раніше dashboard
            // був порожньою заглушкою; реальна аналітика повернеться як
            // окрема `/analytics` сторінка, не через відновлення dashboard.
            value: 'businesses',
            label: 'Бізнеси',
            icon: icons.businesses,
            route: '/business',
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
        (item) => !item.route || !pathname.startsWith(item.route)
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

    /**
     * Bookkeeper toggle helper. Sprint 3 рішення E5 — без Paid-перевірки
     * на frontend і backend; gating піде у Sprint 6 (модалка "Доступно на Paid"
     * для Free-користувачів).
     *
     * Логіка:
     *   1. Optimistic-flip у `authStore` — миттєвий feedback на UI (toggle,
     *      filtering списку бізнесів).
     *   2. PATCH `/users/me { worksAsBookkeeper: !current }` через apiClient.
     *   3. На fail — rollback authStore + toast з UA-message (mapApiCode).
     *
     * `bookkeeperToggle` повертається `null`, коли user не залогінений —
     * Header не рендерить секцію.
     */
    const bookkeeperToggle: BookkeeperToggle | null = user
        ? {
              checked: user.worksAsBookkeeper,
              label: 'Режим бухгалтера',
              description:
                  'вести бізнеси клієнтів, які ще не зареєстровані у Finly',
              onToggle: async () => {
                  const previous = user.worksAsBookkeeper;
                  const next = !previous;
                  // Optimistic — миттєво оновлюємо UI (toggle + список бізнесів).
                  setUser({ ...user, worksAsBookkeeper: next });
                  try {
                      await updateProfile({ worksAsBookkeeper: next });
                  } catch (err) {
                      // Rollback: відновити попередній стан + toast.
                      setUser({ ...user, worksAsBookkeeper: previous });
                      const code =
                          (
                              err as {
                                  response?: {
                                      data?: { error?: { code?: string } };
                                  };
                              }
                          )?.response?.data?.error?.code ?? 'unknown';
                      toast.error(getApiMessage(code, 'users'));
                  }
              },
          }
        : null;

    const fullName = user
        ? getFullName(user.profile.firstName, user.profile.lastName)
        : '';
    const initials = user ? getInitials(fullName, user.email) : '';

    return {
        allItems,
        visibleItems,
        handleSelect,
        bookkeeperToggle,
        initials,
    };
}
