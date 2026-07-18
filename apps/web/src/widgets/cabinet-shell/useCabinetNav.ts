'use client';

import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/entities/user';
import {
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
    return items.map((item) => ({
        ...item,
        isActive:
            !!item.href &&
            (pathname === item.href || pathname.startsWith(`${item.href}/`)),
    }));
}

export function useCabinetNav() {
    const pathname = usePathname();
    const isAdmin = useAuthStore((s) => s.user?.role === 'admin');

    const primary = resolve(CABINET_PRIMARY_NAV, pathname);
    const secondary = resolve(
        CABINET_SECONDARY_NAV.filter((item) => !item.adminOnly || isAdmin),
        pathname
    );

    return { primary, secondary };
}
