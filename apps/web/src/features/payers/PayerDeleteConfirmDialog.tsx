'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { deletePayer, extractApiErrorCode, getApiMessage } from '@/shared/api';
import { usePayersStore } from '@/entities/payer';

import { usePayerDeleteDialogStore } from './payerDeleteDialogStore';

/**
 * Sprint 30 — видалення платника зі списку. Зареєстрований у `app/overlays.tsx`.
 * Запис містить персональні дані третьої особи, тож видалення доступне будь-коли
 * і виконується одразу, без grace-періоду.
 */
export default function PayerDeleteConfirmDialog() {
    const isOpen = usePayerDeleteDialogStore((s) => s.isOpen);
    const payerId = usePayerDeleteDialogStore((s) => s.payerId);
    const payerName = usePayerDeleteDialogStore((s) => s.payerName);
    const close = usePayerDeleteDialogStore((s) => s.close);
    const removeFromList = usePayersStore((s) => s.remove);
    const [deleting, setDeleting] = useState(false);

    const handleConfirm = () => {
        if (!payerId || deleting) return;
        setDeleting(true);
        void (async () => {
            try {
                await deletePayer(payerId);
                removeFromList(payerId);
                toast.success('Платника видалено');
                close();
            } catch (err) {
                toast.error(getApiMessage(extractApiErrorCode(err), 'payers'));
            } finally {
                setDeleting(false);
            }
        })();
    };

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={(open) => !open && !deleting && close()}
            onConfirm={handleConfirm}
            title="Видалити платника?"
            description={
                payerName
                    ? `Запис «${payerName}» буде видалено зі списку.`
                    : 'Запис буде видалено зі списку.'
            }
            confirmLabel="Видалити"
            cancelLabel="Скасувати"
            variant="destructive"
            loading={deleting}
        />
    );
}
