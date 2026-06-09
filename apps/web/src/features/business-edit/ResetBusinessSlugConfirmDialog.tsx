'use client';

import { useAutoCancelOnRouteChange } from '@/shared/lib';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { useResetBusinessSlugConfirmStore } from './resetBusinessSlugConfirmStore';

/**
 * Confirm dialog для скидання slug-у бізнесу. Зареєстрований у
 * `app/overlays.tsx`. `useAutoCancelOnRouteChange` — той самий guard, що в
 * delete-діалогах: `onConfirm` замикає slug cabinet-page-у, тож перехід між
 * бізнесами під час відкритого діалогу мусить його закрити.
 */
export default function ResetBusinessSlugConfirmDialog() {
    const isOpen = useResetBusinessSlugConfirmStore((s) => s.isOpen);
    const onConfirm = useResetBusinessSlugConfirmStore((s) => s.onConfirm);
    const close = useResetBusinessSlugConfirmStore((s) => s.close);

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
            description="Адреса публічної сторінки зміниться на нову випадкову. Старі збережені посилання і надруковані QR ще певний час працюватимуть і вестимуть на нову адресу, потім перестануть."
            confirmLabel="Згенерувати"
            cancelLabel="Скасувати"
        />
    );
}
