'use client';

import { Logo } from '@/entities/brand';
import {
    UiSheet,
    UiSheetContent,
    UiSheetBody,
    UiSheetHeader,
    UiSheetTitle,
} from '@/shared/ui/UiSheet';
import { CabinetNavList } from './CabinetNavList';
import { CabinetAdminGroup } from './CabinetAdminGroup';
import { AccountSection } from './AccountSection';
import { useCabinetNav } from './useCabinetNav';
import { useCabinetDrawerStore } from './cabinetDrawerStore';

/**
 * Мобільний drawer кабінету — той самий вміст, що й sidebar (єдиний конфіг
 * `useCabinetNav`): робочі поверхні + сервіс + акаунт-кластер. Кожен перехід
 * закриває панель.
 */
export default function CabinetDrawer() {
    const { primary, secondary, admin } = useCabinetNav();
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

                {/* Прокручується лише список — логотип зверху і акаунт-кластер
                    знизу лишаються на місці, як у sidebar-і. */}
                <UiSheetBody>
                    <nav
                        aria-label="Навігація кабінету"
                        className="flex flex-1 flex-col gap-6 px-5 pb-6"
                    >
                        <CabinetNavList items={primary} onNavigate={close} />
                        {/* Сервіс притиснутий донизу — дзеркало sidebar-а. */}
                        <div className="mt-auto flex flex-col gap-2">
                            <div className="bg-border h-px" />
                            <CabinetNavList
                                items={secondary}
                                onNavigate={close}
                            />
                            <CabinetAdminGroup
                                items={admin}
                                onNavigate={close}
                            />
                        </div>
                    </nav>
                </UiSheetBody>

                <AccountSection onNavigate={close} />
            </UiSheetContent>
        </UiSheet>
    );
}
