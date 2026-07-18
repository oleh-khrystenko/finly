'use client';

import { Logo } from '@/entities/brand';
import {
    UiSheet,
    UiSheetContent,
    UiSheetHeader,
    UiSheetTitle,
} from '@/shared/ui/UiSheet';
import { CabinetNavList } from './CabinetNavList';
import { AccountSection } from './AccountSection';
import { useCabinetNav } from './useCabinetNav';
import { useCabinetDrawerStore } from './cabinetDrawerStore';

/**
 * Мобільний drawer кабінету — той самий вміст, що й sidebar (єдиний конфіг
 * `useCabinetNav`): робочі поверхні + сервіс + акаунт-кластер. Кожен перехід
 * закриває панель.
 */
export default function CabinetDrawer() {
    const { primary, secondary } = useCabinetNav();
    const isOpen = useCabinetDrawerStore((s) => s.isOpen);
    const close = useCabinetDrawerStore((s) => s.close);

    return (
        <UiSheet open={isOpen} onOpenChange={(open) => !open && close()}>
            <UiSheetContent side="left">
                <UiSheetHeader className="pt-3">
                    <UiSheetTitle className="text-left">
                        <Logo />
                    </UiSheetTitle>
                </UiSheetHeader>

                <nav
                    aria-label="Навігація кабінету"
                    className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 pb-6"
                >
                    <CabinetNavList items={primary} onNavigate={close} />
                    <CabinetNavList items={secondary} onNavigate={close} />
                </nav>

                <AccountSection onNavigate={close} />
            </UiSheetContent>
        </UiSheet>
    );
}
