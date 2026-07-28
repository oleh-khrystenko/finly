'use client';

import { AdminLoadFallback } from './AdminLoadFallback';
import { AdminPayeeAccountForm } from './AdminPayeeAccountForm';
import { useAdminPayee } from './useAdminPayee';

/**
 * Sprint 29 — завантажувач редагування реквізитів системного отримувача.
 *
 * Окремого GET на одні реквізити немає: адмін-детальний ендпоінт віддає
 * отримувача разом з усіма рахунками (`useAdminPayee`), тож потрібний знаходимо
 * в цій відповіді. Порівняння за lowercase — той самий case-insensitive контракт
 * slug-ів, що на бекенді (`slugLower`), інакше посилання з іншим регістром
 * давало б «не знайдено».
 */
export function AdminPayeeAccountEdit({
    slug,
    accountSlug,
}: {
    slug: string;
    accountSlug: string;
}) {
    const { state } = useAdminPayee(slug);
    const account =
        state.phase === 'ready'
            ? state.accounts.find(
                  (a) => a.slugLower === accountSlug.toLowerCase()
              )
            : undefined;

    if (state.phase !== 'ready' || !account) {
        return (
            <AdminLoadFallback
                // Отримувач знайшовся, а таких реквізитів у ньому немає — це
                // саме «не знайдено», не збій запиту.
                phase={state.phase === 'ready' ? 'not-found' : state.phase}
                notFoundTitle="Реквізити не знайдено"
                errorTitle="Не вдалося завантажити реквізити. Оновіть сторінку"
                backHref={`/admin/business/${slug}`}
                backLabel="До отримувача"
            />
        );
    }

    return <AdminPayeeAccountForm payee={state.business} account={account} />;
}
