'use client';

import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/entities/user';
import {
    CABINET_ADMIN_NAV,
    CABINET_PRIMARY_NAV,
    CABINET_SECONDARY_NAV,
    type CabinetNavItem,
} from './cabinetNav';

export interface ResolvedNavItem extends CabinetNavItem {
    isActive: boolean;
}

/**
 * Активним вважається пункт, чий route збігається з поточним шляхом або є його
 * префіксом (`/business` активний і на `/business/foo/account/bar`).
 * `comingSoon`-пункти без route ніколи не активні.
 */
function resolve(items: CabinetNavItem[], pathname: string): ResolvedNavItem[] {
    return items.map((item) => {
        // `href` + будь-які `matchPrefixes`: пункт активний, якщо поточний шлях
        // збігається з одним із них або є його вкладеним роутом.
        const prefixes = [item.href, ...(item.matchPrefixes ?? [])].filter(
            (p): p is string => !!p
        );
        return {
            ...item,
            isActive: prefixes.some(
                (p) => pathname === p || pathname.startsWith(`${p}/`)
            ),
        };
    });
}

export function useCabinetNav() {
    const pathname = usePathname();
    const isAdmin = useAuthStore((s) => s.user?.role === 'admin');

    const primary = resolve(CABINET_PRIMARY_NAV, pathname);
    const secondary = resolve(CABINET_SECONDARY_NAV, pathname);
    // Адмін-пункти живуть окремою групою (акордеон «Адмін» під secondary);
    // для не-адміна група порожня і не рендериться взагалі.
    const admin = isAdmin ? resolve(CABINET_ADMIN_NAV, pathname) : [];

    return { primary, secondary, admin };
}
