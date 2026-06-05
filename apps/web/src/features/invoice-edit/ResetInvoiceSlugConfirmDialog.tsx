'use client';

import { useAutoCancelOnRouteChange } from '@/shared/lib';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { useResetInvoiceSlugConfirmStore } from './resetInvoiceSlugConfirmStore';

/**
 * Confirm dialog для скидання slug-у інвойсу. Зареєстрований у
 * `app/overlays.tsx`. На відміну від business/account, нова адреса будується за
 * форматом нумерації рахунку (наступний номер), тому copy відрізняється.
 */
export default function ResetInvoiceSlugConfirmDialog() {
    const isOpen = useResetInvoiceSlugConfirmStore((s) => s.isOpen);
    const onConfirm = useResetInvoiceSlugConfirmStore((s) => s.onConfirm);
    const close = useResetInvoiceSlugConfirmStore((s) => s.close);

    useAutoCancelOnRouteChange(isOpen, close);

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={(o) => !o && close()}
            onConfirm={() => {
                onConfirm?.();
                close();
            }}
            title="Згенерувати нове посилання?"
            description="Адреса інвойсу зміниться на нову за форматом нумерації рахунку. Старі збережені посилання і надруковані QR ще певний час працюватимуть і вестимуть на нову адресу, потім перестануть."
            confirmLabel="Згенерувати"
            cancelLabel="Скасувати"
        />
    );
}
