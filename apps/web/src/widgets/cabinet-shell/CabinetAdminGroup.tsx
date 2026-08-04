'use client';

import { Shield, ChevronsUpDown } from 'lucide-react';
import UiButton from '@/shared/ui/UiButton';
import UiDropdownMenu from '@/shared/ui/UiDropdownMenu';
import type { UiDropdownMenuItem } from '@/shared/ui/UiDropdownMenu';
import { composeClasses } from '@/shared/lib';
import type { ResolvedNavItem } from './useCabinetNav';
import {
    navRowClass,
    navRowActiveClass,
    navRowHoverClass,
    navIconClass,
} from './styles';

interface CabinetAdminGroupProps {
    items: ResolvedNavItem[];
    /** Викликається при переході — закриває drawer на мобільному. */
    onNavigate?: () => void;
}

/**
 * Адмін-розділи за одним nav-рядком «Адмін», що відкриває попап-меню — той
 * самий патерн, що акаунт-меню в аватарці поверхом нижче. Інструменти
 * другорядні відносно робочих поверхонь, тож не займають постійні рядки
 * навігації; рядок підсвічується активним, коли відкритий адмін-маршрут.
 * Рендериться тільки для адміна (для інших `items` порожній).
 */
export function CabinetAdminGroup({
    items,
    onNavigate,
}: CabinetAdminGroupProps) {
    if (items.length === 0) return null;

    const activeItem = items.find((item) => item.isActive);
    // `href` замість програмного переходу — пункти лишаються посиланнями, як
    // рядки основної навігації: prefetch, Ctrl/середній клік у нову вкладку,
    // контекстне меню. Клік лише закриває drawer, навігацію робить сам лінк.
    const menuItems: UiDropdownMenuItem[] = items.map((item) => ({
        value: item.key,
        label: item.label,
        icon: item.icon,
        href: item.href,
    }));

    return (
        <UiDropdownMenu
            items={menuItems}
            onSelect={() => onNavigate?.()}
            activeValue={activeItem?.key}
            side="top"
            align="start"
            size="sm"
            rootClassName="w-full"
            className="w-full"
            trigger={
                <UiButton
                    variant="text"
                    size="sm"
                    className={composeClasses(
                        navRowClass,
                        activeItem ? navRowActiveClass : navRowHoverClass
                    )}
                >
                    <span className={navIconClass}>
                        <Shield />
                    </span>
                    <span>Адмін</span>
                    {/* Той самий індикатор, що в тригера акаунт-меню нижче —
                        обидва рядки відкривають попап, афорданс єдиний. */}
                    <ChevronsUpDown
                        className="text-muted-foreground ml-auto size-4 shrink-0"
                        aria-hidden="true"
                    />
                </UiButton>
            }
        />
    );
}
