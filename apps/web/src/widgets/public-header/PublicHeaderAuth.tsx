'use client';

import { useSyncExternalStore, type MouseEvent } from 'react';
import {
    Briefcase,
    BookOpen,
    CreditCard,
    Landmark,
    LogOut,
    User,
} from 'lucide-react';
import UiButton from '@/shared/ui/UiButton';
import { ENV } from '@/shared/config';
import { useAuthStore } from '@/entities/user';
import { useUserMenu, UserMenuDropdown } from '@/features/user-menu';

const CABINET_URL = ENV.NEXT_PUBLIC_BASE_URL.replace(/\/$/, '');

/** Вхід у кабінеті з поверненням на передану адресу публічної сторінки. */
function buildSigninUrl(returnTo: string | null): string {
    return returnTo
        ? `${CABINET_URL}/auth/signin?redirect=${encodeURIComponent(returnTo)}`
        : `${CABINET_URL}/auth/signin`;
}

/**
 * Sprint 30 — auth-острівець шапки публічного pay-хоста. Після переїзду сесії
 * на батьківський домен залогінений бачить тут звичне меню кабінету, анонім —
 * кнопку входу.
 *
 * **Строго клієнтський.** Серверний рендер публічних сторінок сесії не читає і
 * не залежить від того, хто відкрив: сторінка однакова для всіх і кешується.
 * Якби персоналізація потрапила в SSR, кешувальний шар віддав би сторінку з
 * даними однієї людини наступному відвідувачу.
 *
 * Вхід веде у кабінет і повертає рівно на цю сторінку: форми входу на
 * pay-хості немає за рішенням спринту.
 */
export default function PublicHeaderAuth() {
    const user = useAuthStore((s) => s.user);
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const isLoading = useAuthStore((s) => s.isLoading);
    // Адреса на момент рендеру — тільки для атрибута `href`, щоб кнопка
    // лишалась повноцінним посиланням (середній клік, копіювання адреси,
    // читалки). На сервері адреси не існує (`null` → просто вхід). Значення
    // навмисно НЕ вважається актуальним: сторінка переписує адресу під час
    // набору без ререндеру шапки, тому звичайний клік бере адресу заново (див.
    // `handleSignin`).
    const returnToAtRender = useSyncExternalStore(
        () => () => {},
        () => window.location.href,
        () => null
    );

    const { visibleItems, handleSelect, initials } = useUserMenu(
        {
            businesses: <Briefcase />,
            profile: <User />,
            billing: <CreditCard />,
            adminGuides: <BookOpen />,
            adminCatalog: <Landmark />,
            logout: <LogOut />,
        },
        {
            cabinetBaseUrl: CABINET_URL,
            // Вихід на публічній сторінці лишає людину там, де вона платила.
            // Перезавантаження, а не просто зміна стану: разом зі сторінкою
            // зникають підставлені у форму дані платника — на спільному
            // комп'ютері наступний відвідувач їх не побачить.
            onLoggedOut: () => window.location.reload(),
        }
    );

    if (isLoading) {
        return (
            <div className="bg-secondary h-8 w-8 animate-pulse rounded-full" />
        );
    }

    if (isAuthenticated && user) {
        return (
            <UserMenuDropdown
                user={user}
                initials={initials}
                items={visibleItems}
                onSelect={(value) => handleSelect(value)}
            />
        );
    }

    // Адресу повернення читаємо в момент кліку, а не з знімка рендеру: поки
    // людина заповнює форму, сторінка переписує адресу (`history.replaceState`
    // у формі персоналізації), а така зміна ререндер не викликає. Заморожений
    // знімок повернув би людину на сторінку без щойно введених значень.
    const handleSignin = (event: MouseEvent<HTMLAnchorElement>) => {
        // Клік з модифікатором (нова вкладка, збереження) лишаємо браузеру.
        if (
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            event.button !== 0
        ) {
            return;
        }
        event.preventDefault();
        window.location.assign(buildSigninUrl(window.location.href));
    };

    return (
        <UiButton
            as="a"
            href={buildSigninUrl(returnToAtRender)}
            onClick={handleSignin}
            variant="text"
            size="sm"
        >
            Увійти
        </UiButton>
    );
}
