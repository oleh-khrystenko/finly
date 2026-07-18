'use client';

import { usePathname, useRouter } from 'next/navigation';
import { User, LogOut, ChevronsUpDown } from 'lucide-react';
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
    const router = useRouter();
    const { user, fullName, initials, handleLogout } = useCabinetAccount();
    const isProfileActive =
        pathname === '/profile' || pathname.startsWith('/profile/');

    if (!user) {
        return (
            <div className="border-border flex items-center gap-2.5 border-t px-4 py-2">
                <div className="bg-secondary size-8 shrink-0 animate-pulse rounded-full" />
                <div className="bg-secondary h-3.5 w-28 animate-pulse rounded" />
            </div>
        );
    }

    const items: UiDropdownMenuItem[] = [
        { value: 'profile', label: 'Профіль', icon: <User /> },
        {
            value: 'logout',
            label: 'Вийти',
            icon: <LogOut />,
            tone: 'destructive',
        },
    ];

    const handleSelect = (value: string) => {
        onNavigate?.();
        if (value === 'profile') {
            router.push('/profile');
        } else if (value === 'logout') {
            handleLogout();
        }
    };

    return (
        <div className="border-border border-t px-2 py-2">
            <UiDropdownMenu
                items={items}
                onSelect={handleSelect}
                activeValue={isProfileActive ? 'profile' : undefined}
                side="top"
                align="start"
                size="sm"
                rootClassName="w-full"
                className="w-full"
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
                        className="min-h-11 w-full rounded-lg px-2 hover:bg-muted lg:min-h-9 [&>span]:flex [&>span]:w-full [&>span]:items-center [&>span]:gap-2.5"
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
