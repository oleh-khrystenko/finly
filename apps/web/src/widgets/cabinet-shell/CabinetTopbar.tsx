'use client';

import { Menu } from 'lucide-react';
import { Logo } from '@/entities/brand';
import UiButton from '@/shared/ui/UiButton';
import UiHeaderShell from '@/shared/ui/UiHeaderShell';
import ChangeTheme from '@/features/change-theme';
import { useCabinetDrawerStore } from './cabinetDrawerStore';

/**
 * Мобільна верхня смуга кабінету (<lg): гамбургер відкриває drawer, логотип
 * веде на головну кабінету, тема доступна одним тапом. На desktop прихована —
 * там навігація в постійному sidebar.
 */
export function CabinetTopbar() {
    const open = useCabinetDrawerStore((s) => s.open);

    return (
        <div className="bg-background/80 border-border sticky top-0 z-40 border-b backdrop-blur-md lg:hidden">
            <UiHeaderShell className="gap-3">
                <div className="flex items-center gap-2">
                    <UiButton
                        variant="icon"
                        size="md"
                        aria-label="Відкрити меню"
                        IconLeft={<Menu />}
                        onClick={open}
                    />
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
                </div>
                <ChangeTheme />
            </UiHeaderShell>
        </div>
    );
}
