'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import {
    deleteGuide,
    extractApiErrorCode,
    getApiMessage,
} from '@/shared/api';

import { useDeleteGuideDialogStore } from './deleteGuideDialogStore';

/**
 * Confirm dialog для видалення чернетки гайда. Зареєстрований у
 * `app/overlays.tsx`. Опубліковані статті видалити не можна (сервер відхилить),
 * тому цей діалог відкривається лише для чернеток; після успіху веде до списку.
 */
export default function DeleteGuideConfirmDialog() {
    const isOpen = useDeleteGuideDialogStore((s) => s.isOpen);
    const guideId = useDeleteGuideDialogStore((s) => s.guideId);
    const guideTitle = useDeleteGuideDialogStore((s) => s.guideTitle);
    const close = useDeleteGuideDialogStore((s) => s.close);
    const router = useRouter();
    const [deleting, setDeleting] = useState(false);

    const handleConfirm = () => {
        if (!guideId || deleting) return;
        setDeleting(true);
        void (async () => {
            try {
                await deleteGuide(guideId);
                toast.success('Гайд видалено');
                close();
                router.push('/admin/guides');
            } catch (err) {
                toast.error(getApiMessage(extractApiErrorCode(err), 'guides'));
            } finally {
                setDeleting(false);
            }
        })();
    };

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={(o) => !o && !deleting && close()}
            onConfirm={handleConfirm}
            title="Видалити гайд?"
            description={
                guideTitle
                    ? `Чернетку «${guideTitle}» буде видалено остаточно.`
                    : ''
            }
            confirmLabel="Видалити"
            cancelLabel="Скасувати"
            variant="destructive"
        />
    );
}
