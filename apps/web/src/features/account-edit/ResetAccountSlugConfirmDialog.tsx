'use client';

import { useAutoCancelOnRouteChange } from '@/shared/lib';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { useResetAccountSlugConfirmStore } from './resetAccountSlugConfirmStore';

/**
 * Confirm dialog для скидання slug-у рахунку. Зареєстрований у
 * `app/overlays.tsx`. `useAutoCancelOnRouteChange` закриває діалог при переході
 * між рахунками (route-local `onConfirm` closure).
 */
export default function ResetAccountSlugConfirmDialog() {
    const isOpen = useResetAccountSlugConfirmStore((s) => s.isOpen);
    const onConfirm = useResetAccountSlugConfirmStore((s) => s.onConfirm);
    const close = useResetAccountSlugConfirmStore((s) => s.close);

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
            description="Адреса сторінки рахунку зміниться на нову випадкову. Старі збережені посилання і надруковані QR ще певний час працюватимуть і вестимуть на нову адресу, потім перестануть."
            confirmLabel="Згенерувати"
            cancelLabel="Скасувати"
        />
    );
}
