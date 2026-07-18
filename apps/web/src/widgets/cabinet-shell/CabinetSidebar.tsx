'use client';

import { Logo } from '@/entities/brand';
import UiButton from '@/shared/ui/UiButton';
import ChangeTheme from '@/features/change-theme';
import { CabinetNavList } from './CabinetNavList';
import { AccountSection } from './AccountSection';
import { useCabinetNav } from './useCabinetNav';

/**
 * Постійне бічне меню кабінету (desktop, ≥lg). Вертикаль: логотип + тема зверху
 * → робочі поверхні → сервіс/акаунт-суміжне (притиснуте донизу навігації) →
 * акаунт-кластер у футері. На вужчих екранах прихований — там drawer.
 */
export function CabinetSidebar() {
    const { primary, secondary } = useCabinetNav();

    return (
        <aside className="bg-card border-border sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r lg:flex">
            <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
                <UiButton
                    as="link"
                    href="/business"
                    variant="text"
                    size="md"
                    aria-label="Кабінет"
                    className="p-0"
                >
                    <Logo />
                </UiButton>
                <ChangeTheme />
            </div>

            <nav
                aria-label="Навігація кабінету"
                className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4"
            >
                <CabinetNavList items={primary} />

                <div className="mt-auto flex flex-col gap-2">
                    <div className="bg-border mx-3 h-px" />
                    <CabinetNavList items={secondary} />
                </div>
            </nav>

            <div className="border-border border-t p-3">
                <AccountSection />
            </div>
        </aside>
    );
}
