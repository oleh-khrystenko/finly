'use client';

import { useEffect } from 'react';

import { useHeaderNavStore } from '@/entities/navigation';

// Порядок МУСИТЬ збігатися з DOM-порядком секцій у `app/page.tsx` —
// scroll-spy (`useActiveSection`) підсвічує перший видимий пункт за порядком
// цього масиву, тож розбіжність із прокруткою ламає активний стан.
const NAV_ITEMS = [
    { href: '#how-it-works', label: 'Як це працює' },
    { href: '#try-now', label: 'Спробувати' },
    { href: '#why', label: 'Чому Finly' },
    { href: '#banks', label: 'Банки' },
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
