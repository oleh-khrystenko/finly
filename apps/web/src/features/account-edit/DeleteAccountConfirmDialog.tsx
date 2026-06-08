'use client';

import { deriveAccountLabel } from '@finly/types';
import { useAutoCancelOnRouteChange } from '@/shared/lib';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { UiDangerGateDialog } from '@/shared/ui/UiDangerGateDialog';
import { useDeleteAccountConfirmStore } from './deleteAccountConfirmStore';

/**
 * Confirm dialog для account-delete-flow. Зареєстрований у `app/overlays.tsx`.
 * Confirm закриває dialog і викликає callback (callsite орхеструє 5s undo +
 * actual cascade-delete у toast).
 *
 * **Дві гілки за `invoicesCount`:**
 *  - `> 0` → `UiDangerGateDialog`: cascade зносить вкладені рахунки, тому
 *    кнопка активується лише після того, як користувач вписав їхню кількість.
 *  - `=== 0` → простий `UiConfirmDialog` (нема чому зникати, крім самих
 *    реквізитів).
 *
 * **Lifecycle cleanup на route-change** — `useAutoCancelOnRouteChange`. Без
 * guard-а ФОП міг би відкрити confirm на реквізитах A, перейти на B,
 * натиснути Confirm — і запустити 5s-undo для A у його cabinet-context.
 */
export default function DeleteAccountConfirmDialog() {
    const isOpen = useDeleteAccountConfirmStore((s) => s.isOpen);
    const account = useDeleteAccountConfirmStore((s) => s.account);
    const invoicesCount = useDeleteAccountConfirmStore((s) => s.invoicesCount);
    const onConfirm = useDeleteAccountConfirmStore((s) => s.onConfirm);
    const close = useDeleteAccountConfirmStore((s) => s.close);

    useAutoCancelOnRouteChange(isOpen, close);

    const label = account
        ? deriveAccountLabel({
              name: account.name,
              bankCode: account.bankCode,
              ibanMask: `•${account.iban.slice(-4)}`,
          })
        : '';

    const confirmAndClose = () => {
        onConfirm?.();
        close();
    };

    if (account && invoicesCount > 0) {
        return (
            <UiDangerGateDialog
                open={isOpen}
                onOpenChange={(o) => !o && close()}
                onConfirm={confirmAndClose}
                title="Видалити реквізити?"
                description={`«${label}» буде видалено остаточно разом з усіма виставленими рахунками (${invoicesCount} шт). Клієнти, які мають збережене посилання, не зможуть оплатити.`}
                gates={[
                    {
                        label: 'Виставлені рахунки',
                        expected: String(invoicesCount),
                    },
                ]}
                renderPrompt={(input) => (
                    <>
                        Впишіть кількість рахунків {input(0)}, щоб підтвердити
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
            title="Видалити реквізити?"
            description={
                account
                    ? `«${label}» буде видалено. Клієнти, які мають збережене посилання, не зможуть оплатити.`
                    : ''
            }
            confirmLabel="Видалити"
            cancelLabel="Скасувати"
            variant="destructive"
        />
    );
}
