'use client';

import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { useDeleteBusinessConfirmStore } from './deleteBusinessConfirmStore';

/**
 * Sprint 3 §3.8 — confirm dialog для delete-flow. Зареєстрований у
 * `app/overlays.tsx`. Confirm закриває dialog і викликає callback
 * (cabinet page орхеструє 5s undo + actual delete у toast).
 */
export default function DeleteBusinessConfirmDialog() {
    const isOpen = useDeleteBusinessConfirmStore((s) => s.isOpen);
    const business = useDeleteBusinessConfirmStore((s) => s.business);
    const onConfirm = useDeleteBusinessConfirmStore((s) => s.onConfirm);
    const close = useDeleteBusinessConfirmStore((s) => s.close);

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={(o) => !o && close()}
            onConfirm={() => {
                onConfirm?.();
                close();
            }}
            title="Видалити бізнес?"
            description={
                business
                    ? `«${business.name}» буде видалено. Клієнти, які мають збережене посилання, не зможуть оплатити.`
                    : ''
            }
            confirmLabel="Видалити"
            cancelLabel="Скасувати"
            variant="destructive"
        />
    );
}
