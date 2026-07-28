'use client';

import { AdminLoadFallback } from './AdminLoadFallback';
import { AdminPayeeForm } from './AdminPayeeForm';
import { useAdminPayee } from './useAdminPayee';

/**
 * Sprint 29 — завантажувач редагування системного отримувача: тягне поточні дані
 * (адмін-fetch під auth) і віддає їх у `AdminPayeeForm` як `existing`. Стан-машина
 * завантаження спільна для всіх адмін-сторінок запису (`useAdminPayee`), щоб
 * сторінка лишалась тонкою.
 */
export function AdminPayeeEdit({ slug }: { slug: string }) {
    const { state } = useAdminPayee(slug);

    if (state.phase !== 'ready') {
        return (
            <AdminLoadFallback
                phase={state.phase}
                notFoundTitle="Отримувача не знайдено"
                errorTitle="Не вдалося завантажити отримувача. Оновіть сторінку"
                backHref="/admin/payees"
                backLabel="До списку"
            />
        );
    }

    return <AdminPayeeForm existing={state.business} />;
}
