'use client';

import { deriveAccountLabel } from '@finly/types';
import { useAutoCancelOnRouteChange } from '@/shared/lib';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { useDeleteAccountConfirmStore } from './deleteAccountConfirmStore';

/**
 * Sprint 9 §9.2 — confirm dialog для account-delete-flow. Той самий patern,
 * що Sprint 3 `DeleteBusinessConfirmDialog` і Sprint 4
 * `DeleteInvoiceConfirmDialog`. Зареєстрований у `app/overlays.tsx`.
 *
 * **Single-action confirm**, без cascade-warning у dialog-і. Pre-check
 * `invoicesCount > 0` живе у callsite (cabinet account-page / per-card
 * AccountsSection) і генерує `toast.error(ACCOUNT_HAS_INVOICES)` без
 * відкриття цього dialog-у. Тобто диалог відкривається тільки коли
 * `invoicesCount === 0` і delete легітимний.
 *
 * **Lifecycle cleanup на route-change** — той самий клас проблеми, що
 * `DeleteBusinessConfirmDialog` / `DeleteInvoiceConfirmDialog`: глобальний
 * store + route-local closure. Без guard-а ФОП міг би відкрити confirm на
 * account A, перейти на account B, натиснути Confirm — і запустити 5s-undo
 * для A з redirect-ом у його cabinet-context.
 */
export default function DeleteAccountConfirmDialog() {
    const isOpen = useDeleteAccountConfirmStore((s) => s.isOpen);
    const account = useDeleteAccountConfirmStore((s) => s.account);
    const onConfirm = useDeleteAccountConfirmStore((s) => s.onConfirm);
    const close = useDeleteAccountConfirmStore((s) => s.close);

    useAutoCancelOnRouteChange(isOpen, close);

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={(o) => !o && close()}
            onConfirm={() => {
                onConfirm?.();
                close();
            }}
            title="Видалити рахунок?"
            description={
                account
                    ? `«${deriveAccountLabel({
                          name: account.name,
                          bankCode: account.bankCode,
                          ibanMask: `•${account.iban.slice(-4)}`,
                      })}» буде видалено. Клієнти, які мають збережене посилання, не зможуть оплатити.`
                    : ''
            }
            confirmLabel="Видалити"
            cancelLabel="Скасувати"
            variant="destructive"
        />
    );
}
