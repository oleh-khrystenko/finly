'use client';

import { ReactNode } from 'react';
import { CabinetSidebar } from './CabinetSidebar';
import { CabinetTopbar } from './CabinetTopbar';

/**
 * Каркас кабінету: постійний sidebar (desktop) або topbar+drawer (mobile) зліва
 * від контенту. Замінив старий `Header` над контентом — навігацію винесено з
 * аватар-меню у виділене бічне меню.
 *
 * Футера під контентом немає — юридика (Конфіденційність, Умови) і підтримка
 * живуть в акаунт-меню внизу sidebar/drawer (`AccountSection`), контент займає
 * всю висоту.
 */
export function CabinetShell({ children }: { children: ReactNode }) {
    return (
        <div className="flex flex-1">
            <CabinetSidebar />

            <div className="flex min-w-0 flex-1 flex-col">
                <CabinetTopbar />
                {/* Не `<main>`: landmark несе сама сторінка (`UiPageContainer`
                    вже є `<main>`), два вкладені main — невалідний HTML. */}
                <div className="flex flex-1 flex-col">{children}</div>
            </div>
        </div>
    );
}
