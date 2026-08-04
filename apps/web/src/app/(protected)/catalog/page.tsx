import type { Metadata } from 'next';
import { BadgeCheck } from 'lucide-react';

import { CatalogSections, loadCatalogSafe } from '@/features/catalog';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import { ENV } from '@/shared/config/env';

/**
 * Каталог перевірених отримувачів у кабінеті. Вітрина живе на pay-хості і там
 * лишається канонічною; тут те саме тіло (`CatalogSections`) у кабінетній
 * оболонці, щоб платити податки можна було не виходячи з робочої поверхні.
 *
 * Пошук відбувається в кабінеті, а на pay-зону людина йде вже обраним
 * отримувачем — картки ведуть туди абсолютними посиланнями у новій вкладці.
 * Сесія спільна для обох хостів, тож підстановка даних платника на податковій
 * сторінці працює одразу, без повторного входу.
 *
 * `narrow` — картки тут рядкові, і на широкому моніторі назва отримувача та
 * «Відкрити» розʼїхалися б через пів екрана. Та сама міра, що на публічній
 * вітрині, тож дві поверхні читаються як одна сторінка.
 *
 * `loadCatalogSafe` ковтає збій API і віддає порожній каталог: сторінка тоді
 * показує той самий пояснювач, що й на порожньому каталозі, а не падає — це
 * допоміжний розділ кабінету, і мертвий бекенд каталогу не має ламати роботу
 * з власними отримувачами.
 */
export const metadata: Metadata = {
    title: 'Каталог отримувачів | Finly',
    robots: { index: false, follow: false },
};

export default async function CabinetCatalogPage() {
    const catalog = await loadCatalogSafe();
    const isEmpty = catalog.sections.length === 0;

    return (
        <UiPageContainer narrow className="space-y-6">
            <div className="space-y-1">
                <UiPageHeading>Каталог</UiPageHeading>
                <p className="text-muted-foreground max-w-prose text-sm">
                    Перевірені отримувачі: податкова, фонди, благодійність.
                    Сторінка оплати відкриється в новій вкладці.
                </p>
            </div>

            {isEmpty ? (
                <EmptyState />
            ) : (
                <div className="space-y-8">
                    <CatalogSections
                        catalog={catalog}
                        linkOrigin={ENV.NEXT_PUBLIC_PAY_PUBLIC_URL}
                    />
                </div>
            )}
        </UiPageContainer>
    );
}

function EmptyState() {
    return (
        <div className="border-border bg-card flex flex-col items-center gap-4 rounded-xl border p-10 text-center md:p-16">
            <div className="bg-muted text-muted-foreground flex size-16 items-center justify-center rounded-full">
                <BadgeCheck className="size-8" />
            </div>
            <div className="space-y-1">
                <h2 className="text-foreground text-lg font-semibold">
                    Каталог поки порожній
                </h2>
                <p className="text-muted-foreground max-w-md text-sm">
                    Тут зʼявляться перевірені отримувачі — податкова, фонди,
                    благодійні організації. Загляньте пізніше.
                </p>
            </div>
        </div>
    );
}
