'use client';

import { useAutoCancelOnRouteChange } from '@/shared/lib';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { UiDangerGateDialog } from '@/shared/ui/UiDangerGateDialog';

import { useDeleteAdminPayeeConfirmStore } from './deleteAdminPayeeConfirmStore';

/**
 * Sprint 29 — підтвердження каскадного видалення системного отримувача.
 * Зареєстрований у `app/overlays.tsx`.
 *
 * **Дві гілки за `accountsCount`** (дзеркало кабінетного
 * `DeleteBusinessConfirmDialog`):
 *  - `> 0` → `UiDangerGateDialog`: разом з отримувачем зникають усі його
 *    реквізити, тому кнопка активується лише після того, як адмін вписав їхню
 *    кількість. Записи публічні, тож ціна помилки це мертві посилання у
 *    платників.
 *  - `=== 0` → простий `UiConfirmDialog`: зникати нема чому, крім самого запису.
 *
 * Виставлених рахунків у системного отримувача не буває (він не виставляє
 * документів), тож другого рівня gate тут немає.
 *
 * `useAutoCancelOnRouteChange` закриває діалог на зміні маршруту: інакше
 * відкрите підтвердження з отримувача A могло б спрацювати вже на сторінці B.
 */
export default function DeleteAdminPayeeConfirmDialog() {
    const isOpen = useDeleteAdminPayeeConfirmStore((s) => s.isOpen);
    const payeeName = useDeleteAdminPayeeConfirmStore((s) => s.payeeName);
    const accountsCount = useDeleteAdminPayeeConfirmStore(
        (s) => s.accountsCount
    );
    const onConfirm = useDeleteAdminPayeeConfirmStore((s) => s.onConfirm);
    const close = useDeleteAdminPayeeConfirmStore((s) => s.close);

    useAutoCancelOnRouteChange(isOpen, close);

    const confirmAndClose = () => {
        onConfirm?.();
        close();
    };

    if (accountsCount > 0) {
        return (
            <UiDangerGateDialog
                open={isOpen}
                onOpenChange={(o) => !o && close()}
                onConfirm={confirmAndClose}
                title="Видалити отримувача?"
                description={`«${payeeName}» буде видалено остаточно разом з усіма реквізитами (${accountsCount} шт). Отримувач зникне з каталогу, а збережені посилання платників перестануть працювати.`}
                gates={[
                    {
                        label: 'Реквізити',
                        expected: String(accountsCount),
                    },
                ]}
                renderPrompt={(input) => (
                    <>
                        Впишіть кількість реквізитів {input(0)}, щоб підтвердити
                        видалення.
                    </>
                )}
                confirmLabel="Видалити"
                cancelLabel="Скасувати"
            />
        );
    }

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={(o) => !o && close()}
            onConfirm={confirmAndClose}
            title="Видалити отримувача?"
            description={`«${payeeName}» буде видалено остаточно. Отримувач зникне з каталогу, а збережені посилання платників перестануть працювати.`}
            confirmLabel="Видалити"
            cancelLabel="Скасувати"
            variant="destructive"
        />
    );
}
