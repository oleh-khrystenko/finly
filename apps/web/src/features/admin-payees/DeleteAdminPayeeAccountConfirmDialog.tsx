'use client';

import { useAutoCancelOnRouteChange } from '@/shared/lib';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';

import { useDeleteAdminPayeeAccountConfirmStore } from './deleteAdminPayeeAccountConfirmStore';

/**
 * Sprint 29 — підтвердження видалення реквізитів системного отримувача.
 * Зареєстрований у `app/overlays.tsx`.
 *
 * Простий `UiConfirmDialog`, а не gate-діалог: під реквізитами системного
 * отримувача немає піддерева документів, тож підтверджувати масштаб втрати
 * нема чого (overlays.md §4 — одне питання, один confirm).
 */
export default function DeleteAdminPayeeAccountConfirmDialog() {
    const isOpen = useDeleteAdminPayeeAccountConfirmStore((s) => s.isOpen);
    const accountLabel = useDeleteAdminPayeeAccountConfirmStore(
        (s) => s.accountLabel
    );
    const onConfirm = useDeleteAdminPayeeAccountConfirmStore(
        (s) => s.onConfirm
    );
    const close = useDeleteAdminPayeeAccountConfirmStore((s) => s.close);

    useAutoCancelOnRouteChange(isOpen, close);

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={(o) => !o && close()}
            onConfirm={() => {
                onConfirm?.();
                close();
            }}
            title="Видалити реквізити?"
            description={`«${accountLabel}» буде видалено остаточно. Реквізити зникнуть з каталогу, а збережені посилання платників перестануть працювати.`}
            confirmLabel="Видалити"
            cancelLabel="Скасувати"
            variant="destructive"
        />
    );
}
