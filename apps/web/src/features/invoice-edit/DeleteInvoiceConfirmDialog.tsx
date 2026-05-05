'use client';

import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { useDeleteInvoiceConfirmStore } from './deleteInvoiceConfirmStore';

/**
 * Sprint 4 §4.6 — confirm dialog для invoice-delete-flow. Той самий patern,
 * що Sprint 3 `DeleteBusinessConfirmDialog`. Зареєстрований у
 * `app/overlays.tsx`. Confirm-кнопка викликає callback (cabinet page орхеструє
 * 5s undo + actual delete у toast).
 */
export default function DeleteInvoiceConfirmDialog() {
    const isOpen = useDeleteInvoiceConfirmStore((s) => s.isOpen);
    const invoice = useDeleteInvoiceConfirmStore((s) => s.invoice);
    const onConfirm = useDeleteInvoiceConfirmStore((s) => s.onConfirm);
    const close = useDeleteInvoiceConfirmStore((s) => s.close);

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
                invoice
                    ? `Рахунок «${invoice.slug}» буде видалено. Клієнт, який має збережене посилання, не зможе оплатити.`
                    : ''
            }
            confirmLabel="Видалити"
            cancelLabel="Скасувати"
            variant="destructive"
        />
    );
}
