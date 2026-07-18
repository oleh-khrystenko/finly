'use client';

import { usePathname } from 'next/navigation';
import { User, LogOut } from 'lucide-react';
import UiButton from '@/shared/ui/UiButton';
import { UiAvatar } from '@/shared/ui/UiAvatar';
import { composeClasses } from '@/shared/lib';
import { useCabinetAccount } from './useCabinetAccount';
import {
    navRowClass,
    navRowActiveClass,
    navRowHoverClass,
    navIconClass,
} from './styles';

/**
 * Акаунт-кластер (низ sidebar / низ drawer): особистий блок + Профіль + Вийти.
 * Свідомо inline (а не dropdown): на дні full-height sidebar випадне меню
 * розкрилось би за межі viewport. Тема живе окремо у верхній смузі, тож тут
 * лише те, що справді про акаунт і сесію.
 */
export function AccountSection({ onNavigate }: { onNavigate?: () => void }) {
    const pathname = usePathname();
    const { user, fullName, initials, handleLogout } = useCabinetAccount();
    const isProfileActive =
        pathname === '/profile' || pathname.startsWith('/profile/');

    if (!user) {
        return (
            <div className="flex items-center gap-3 px-3 py-2">
                <div className="bg-secondary size-9 shrink-0 animate-pulse rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5">
                    <div className="bg-secondary h-3.5 w-24 animate-pulse rounded" />
                    <div className="bg-secondary h-3 w-32 animate-pulse rounded" />
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 px-3 py-2">
                <UiAvatar
                    size="sm"
                    src={user.profile.avatar}
                    alt={fullName}
                    fallback={initials}
                />
                <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                        {fullName}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">
                        {user.email}
                    </span>
                </div>
            </div>

            <UiButton
                as="link"
                href="/profile"
                variant="text"
                size="sm"
                linkPending={false}
                onClick={onNavigate}
                aria-current={isProfileActive ? 'page' : undefined}
                className={composeClasses(
                    navRowClass,
                    isProfileActive ? navRowActiveClass : navRowHoverClass
                )}
            >
                <span className={navIconClass}>
                    <User />
                </span>
                <span>Профіль</span>
            </UiButton>

            <UiButton
                type="button"
                variant="destructive-text"
                size="sm"
                onClick={() => {
                    onNavigate?.();
                    handleLogout();
                }}
                className={composeClasses(navRowClass, 'hover:bg-destructive/10')}
            >
                <span className={navIconClass}>
                    <LogOut />
                </span>
                <span>Вийти</span>
            </UiButton>
        </div>
    );
}
