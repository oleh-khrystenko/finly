'use client';

import { useState } from 'react';
import { canEnterCatalog, type Account, type Business } from '@finly/types';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSwitch from '@/shared/ui/UiSwitch';

interface Props {
    business: Business;
    account: Account;
    /** Тогл видимості цих реквізитів у каталозі. Кидає при помилці (toast на сторінці). */
    onToggle: (visible: boolean) => Promise<void>;
}

/**
 * Sprint 29 — видимість окремих реквізитів у каталозі. Показується лише коли
 * отримувач допущений (системний або схвалений): для непублічного отримувача
 * керування каталогом живе на його сторінці, тут дублювати нема сенсу.
 *
 * Якщо отримувач публічний, але у рахунку немає красивого slug, тогл заблоковано
 * підказкою: допуск рівня вимагає красивого посилання (`canEnterCatalog`).
 */
export default function AccountCatalogSection({
    business,
    account,
    onToggle,
}: Props) {
    const [busy, setBusy] = useState(false);

    const payeePublic =
        business.isSystem || business.publicityStatus === 'approved';
    if (!payeePublic) return null;

    const eligible = canEnterCatalog({
        isSystem: business.isSystem,
        publicityStatus: business.publicityStatus,
        slugCustomized: account.slugCustomized,
    });

    const handleToggle = async (next: boolean) => {
        setBusy(true);
        try {
            await onToggle(next);
        } catch {
            // Сторінка показала toast.
        } finally {
            setBusy(false);
        }
    };

    return (
        <UiSectionCard title="Каталог Finly">
            {eligible ? (
                <label
                    htmlFor="account-catalog-toggle"
                    className="mt-2 flex cursor-pointer flex-col gap-1"
                >
                    <span className="flex items-center justify-between gap-3">
                        <span className="text-foreground text-lg font-medium">
                            {account.catalogVisible
                                ? 'Реквізити показуються в каталозі'
                                : 'Реквізити приховані з каталогу'}
                        </span>
                        <UiSwitch
                            id="account-catalog-toggle"
                            className="shrink-0"
                            checked={account.catalogVisible}
                            disabled={busy}
                            onChange={(next) => void handleToggle(next)}
                        />
                    </span>
                    <span className="text-muted-foreground text-sm">
                        Керує показом саме цих реквізитів у публічному каталозі.
                    </span>
                </label>
            ) : (
                <p className="text-muted-foreground mt-2 text-sm">
                    Дайте цим реквізитам красиве посилання (вище), щоб показати
                    їх у каталозі.
                </p>
            )}
        </UiSectionCard>
    );
}
