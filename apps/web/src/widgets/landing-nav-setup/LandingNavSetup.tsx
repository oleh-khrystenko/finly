'use client';

import { useEffect } from 'react';

import { useHeaderNavStore } from '@/entities/navigation';

const NAV_ITEMS = [
    { href: '#how-it-works', label: 'Як це працює' },
    { href: '#why', label: 'Чому Finly' },
    { href: '#try-now', label: 'Спробувати' },
] as const;

/**
 * Реєструє anchor-nav у header-store при mount-і і чистить на unmount.
 * Header вже містить sticky-nav + scroll-spy для `activeSection`
 * (`useActiveSection.ts`) — нам лишається лише `setNav`. Cleanup потрібен,
 * бо при переході на /privacy/terms header має повернутись у default-mode.
 */
export function LandingNavSetup() {
    const setNav = useHeaderNavStore((s) => s.setNav);
    const clearNav = useHeaderNavStore((s) => s.clearNav);

    useEffect(() => {
        setNav([...NAV_ITEMS]);
        return () => clearNav();
    }, [setNav, clearNav]);

    return null;
}
