'use client';

import { useAutoCancelOnRouteChange } from '@/shared/lib';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { useDeleteInvoiceConfirmStore } from './deleteInvoiceConfirmStore';

/**
 * Sprint 4 §4.6 — confirm dialog для invoice-delete-flow. Той самий patern,
 * що Sprint 3 `DeleteBusinessConfirmDialog`. Зареєстрований у
 * `app/overlays.tsx`. Confirm-кнопка викликає callback (cabinet page орхеструє
 * 5s undo + actual delete у toast).
 *
 * **Lifecycle cleanup на route-change (review fix)** — той самий клас
 * проблеми, що `SlugPresetWarningDialog`. Store глобальний, але `onConfirm`
 * — closure cabinet-page-у, що замикає current `invoice`/`business` slug
 * та `router`. Без guard-а ФОП міг би: відкрити confirm на рахунку A,
 * перейти на рахунок B (або інший бізнес), натиснути Confirm — і запустити
 * 5s-undo для рахунку A з redirect-ом у його cabinet-context (тоді як
 * користувач уже на B). `useAutoCancelOnRouteChange` авто-close-ить dialog
 * при зміні pathname-у — store очищується, stale closure не виконається.
 */
export default function DeleteInvoiceConfirmDialog() {
    const isOpen = useDeleteInvoiceConfirmStore((s) => s.isOpen);
    const invoice = useDeleteInvoiceConfirmStore((s) => s.invoice);
    const onConfirm = useDeleteInvoiceConfirmStore((s) => s.onConfirm);
    const close = useDeleteInvoiceConfirmStore((s) => s.close);

    useAutoCancelOnRouteChange(isOpen, close);

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={(o) => !o && close()}
            onConfirm={() => {
                onConfirm?.();
                close();
            }}
            title="Видалити інвойс?"
            description={
                invoice
                    ? `Інвойс «${invoice.slug}» буде видалено. Клієнт, який має збережене посилання, не зможе оплатити.`
                    : ''
            }
            confirmLabel="Видалити"
            cancelLabel="Скасувати"
            variant="destructive"
        />
    );
}
