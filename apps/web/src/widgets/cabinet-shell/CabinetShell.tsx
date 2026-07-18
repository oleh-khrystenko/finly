'use client';

import { ReactNode } from 'react';
import { AppFooter } from '@/widgets/app-footer';
import { CabinetSidebar } from './CabinetSidebar';
import { CabinetTopbar } from './CabinetTopbar';

/**
 * Каркас кабінету: постійний sidebar (desktop) або topbar+drawer (mobile) зліва
 * від контенту. Замінив старий `Header` над контентом — навігацію винесено з
 * аватар-меню у виділене бічне меню.
 *
 * Футер лишається мінімальним (юридика + підтримка), Довідку прибрано —
 * вона тепер першокласний пункт навігації у sidebar.
 */
export function CabinetShell({ children }: { children: ReactNode }) {
    return (
        <div className="flex flex-1">
            <CabinetSidebar />

            <div className="flex min-w-0 flex-1 flex-col">
                <CabinetTopbar />
                <main className="flex flex-1 flex-col">{children}</main>
                <AppFooter showHelpLink={false} />
            </div>
        </div>
    );
}
