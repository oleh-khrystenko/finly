'use client';

import { usePathname } from 'next/navigation';
import {
    User,
    LogOut,
    ChevronsUpDown,
    FileText,
    Lock,
    Mail,
} from 'lucide-react';
import UiButton from '@/shared/ui/UiButton';
import UiDropdownMenu from '@/shared/ui/UiDropdownMenu';
import type { UiDropdownMenuItem } from '@/shared/ui/UiDropdownMenu';
import { UiAvatar } from '@/shared/ui/UiAvatar';
import { useCabinetAccount } from './useCabinetAccount';

/**
 * Акаунт-меню в аватарці (низ sidebar / низ drawer). Тригер — однорядковий
 * аватар + ім'я; клік розкриває вгору (`side="top"` — на дні sidebar меню вниз
 * випало б за viewport) Профіль + Вийти, email — у шапці меню. Смуга з власною
 * `border-t` + `py-2` тримає ту саму висоту, що copyright-смуга у футері.
 */
export function AccountSection({ onNavigate }: { onNavigate?: () => void }) {
    const pathname = usePathname();
    const { user, fullName, initials, handleLogout } = useCabinetAccount();
    const isProfileActive =
        pathname === '/profile' || pathname.startsWith('/profile/');

    if (!user) {
        return (
            <div className="border-border flex items-center gap-2.5 border-t px-3 py-2">
                <div className="bg-secondary size-8 shrink-0 animate-pulse rounded-full" />
                <div className="bg-secondary h-3.5 w-28 animate-pulse rounded" />
            </div>
        );
    }

    // Юридика і підтримка живуть тут, а не окремим блоком у сайдбарі:
    // другорядні лінки в аватар-меню (патерн GitHub) не засмічують навігацію.
    // Навігаційні пункти несуть `href` — це справжні посилання (нова вкладка,
    // контекстне меню, prefetch), як і рядки основної навігації. Кнопкою
    // лишається тільки «Вийти»: це дія, а не перехід.
    const items: UiDropdownMenuItem[] = [
        {
            value: 'profile',
            label: 'Профіль',
            icon: <User />,
            href: '/profile',
        },
        {
            value: 'privacy',
            label: 'Конфіденційність',
            icon: <Lock />,
            href: '/privacy',
            separatorBefore: true,
        },
        { value: 'terms', label: 'Умови', icon: <FileText />, href: '/terms' },
        {
            // Лейбл — сама адреса, не слово «Підтримка»: адреса і є інформація
            // (видно, куди пишеш, можна скопіювати).
            value: 'support',
            label: 'support@finly.com.ua',
            icon: <Mail />,
            href: 'mailto:support@finly.com.ua',
            external: true,
            // mailto ненадійний (поштовий клієнт часто не налаштований) —
            // копіювання адреси і є основний сценарій.
            copyValue: 'support@finly.com.ua',
            copySuccessMessage: 'Адресу скопійовано',
        },
        {
            value: 'logout',
            label: 'Вийти',
            icon: <LogOut />,
            tone: 'destructive',
            separatorBefore: true,
        },
    ];

    // Переходи робить сам лінк; тут лишається закрити drawer і обробити дію.
    const handleSelect = (value: string) => {
        onNavigate?.();
        if (value === 'logout') {
            handleLogout();
        }
    };

    // px-3 (wrapper) + px-3 (кнопка) = 24px інсети — рівно як nav-рядки
    // (`nav px-3` + `navRowClass px-3`), інакше шеврони акаунта і «Адмін»
    // стояли б на різній вертикалі.
    return (
        <div className="border-border border-t px-3 py-2">
            <UiDropdownMenu
                items={items}
                onSelect={handleSelect}
                activeValue={isProfileActive ? 'profile' : undefined}
                side="top"
                align="start"
                size="sm"
                rootClassName="w-full"
                // `w-max` — явна max-content ширина: shrink-to-fit абсолютної
                // панелі обрізається containing block-ом (root = ширина
                // тригера), тож без неї email + копі-кнопка не влазять у
                // sidebar-ширину. Панель нависає над контентом праворуч —
                // звичайна поведінка dropdown. `min-w-full` — не вужче за
                // тригер, коли вміст короткий.
                className="w-max min-w-full"
                header={
                    <span className="text-muted-foreground block truncate text-xs">
                        {user.email}
                    </span>
                }
                trigger={
                    <UiButton
                        variant="text"
                        size="sm"
                        aria-label="Меню акаунта"
                        className="hover:bg-muted min-h-11 w-full rounded-lg px-3 lg:min-h-9 [&>span]:flex [&>span]:w-full [&>span]:items-center [&>span]:gap-2.5"
                    >
                        <UiAvatar
                            size="sm"
                            src={user.profile.avatar}
                            alt={fullName}
                            fallback={initials}
                        />
                        <span className="text-foreground min-w-0 flex-1 truncate text-left text-sm font-medium">
                            {fullName}
                        </span>
                        <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
                    </UiButton>
                }
            />
        </div>
    );
}
