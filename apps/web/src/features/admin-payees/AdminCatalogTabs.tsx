'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

import UiButton from '@/shared/ui/UiButton';
import { composeClasses } from '@/shared/lib';
import { usePublicityCountStore } from './publicityCountStore';

/**
 * Таб-навігація адмін-каталогу. Свідомо route-based (два посилання), а не
 * local-state таби: кожен таб — окремий URL, тож deep-link, перезавантаження і
 * кнопка «назад» тримаються, а підсвітка пункту sidebar не губиться на
 * під-сторінках CRUD (`/admin/payees/[slug]` лишає активним таб «Отримувачі»).
 */
const QUEUE_HREF = '/admin/publicity';

const TABS = [
    { label: 'Отримувачі', href: '/admin/payees' },
    { label: 'Запити', href: QUEUE_HREF },
] as const;

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

    return (
        <nav
            aria-label="Розділи каталогу"
            className="border-border mb-8 border-b"
        >
            <ul className="flex gap-1">
                {TABS.map((tab) => {
                    const isActive =
                        pathname === tab.href ||
                        pathname.startsWith(`${tab.href}/`);
                    const showCount =
                        tab.href === QUEUE_HREF && count !== null && count > 0;
                    return (
                        <li key={tab.href}>
                            <UiButton
                                as="link"
                                href={tab.href}
                                variant="text"
                                size="md"
                                linkPending={false}
                                aria-current={isActive ? 'page' : undefined}
                                aria-label={
                                    showCount
                                        ? `${tab.label}, ${count} на розгляді`
                                        : undefined
                                }
                                className={composeClasses(
                                    '-mb-px min-h-11 border-b-2',
                                    isActive
                                        ? 'border-primary text-foreground!'
                                        : 'border-transparent'
                                )}
                            >
                                <span className="inline-flex items-center gap-2">
                                    {tab.label}
                                    {showCount && (
                                        <span className="bg-primary/10 text-primary inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs leading-none font-semibold">
                                            {count}
                                        </span>
                                    )}
                                </span>
                            </UiButton>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
