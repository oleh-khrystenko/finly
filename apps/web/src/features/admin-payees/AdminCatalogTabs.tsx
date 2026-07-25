'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

import UiTabs from '@/shared/ui/UiTabs';
import type { UiTabNavItem } from '@/shared/ui/UiTabs';
import { usePublicityCountStore } from './publicityCountStore';

/**
 * Таб-навігація адмін-каталогу. Свідомо route-based (два посилання), а не
 * local-state таби: кожен таб — окремий URL, тож deep-link, перезавантаження і
 * кнопка «назад» тримаються, а підсвітка пункту sidebar не губиться на
 * під-сторінках CRUD (`/admin/payees/[slug]` лишає активним таб «Отримувачі»).
 */
const QUEUE_HREF = '/admin/publicity';

export function AdminCatalogTabs() {
    const pathname = usePathname();
    const count = usePublicityCountStore((s) => s.count);
    const refresh = usePublicityCountStore((s) => s.refresh);

    const onQueuePage =
        pathname === QUEUE_HREF || pathname.startsWith(`${QUEUE_HREF}/`);

    // Число заявок треба на обох табах. На сторінці черги його ставить сам
    // список (той самий запит), тож тут тягнемо лише поза чергою — інакше був би
    // дубль запиту до `/admin/publicity` на кожне завантаження черги.
    useEffect(() => {
        if (!onQueuePage) void refresh();
    }, [onQueuePage, refresh]);

    const showCount = count !== null && count > 0;
    const items: UiTabNavItem[] = [
        { value: 'payees', label: 'Отримувачі', href: '/admin/payees' },
        {
            value: 'publicity',
            label: 'Запити',
            href: QUEUE_HREF,
            // Число «на розгляді» має привертати увагу — primary-тон badge.
            count: showCount ? count : undefined,
            countTone: 'primary',
            ariaLabel: showCount ? `Запити, ${count} на розгляді` : undefined,
        },
    ];

    return (
        <UiTabs
            as="nav"
            aria-label="Розділи каталогу"
            className="mb-8"
            items={items}
        />
    );
}
