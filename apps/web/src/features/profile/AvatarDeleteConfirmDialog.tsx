'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { deleteAvatar } from '@/shared/api';
import { useAuthStore } from '@/entities/user';

import { useAvatarDeleteConfirmDialogStore } from './avatarDeleteConfirmDialogStore';

/**
 * Globally mounted confirm dialog for avatar deletion. Registered through
 * `app/overlays.tsx` and opened by `AvatarUploadDialog` (which closes itself
 * first — see overlays.md Rule 7 on no-nested-overlays).
 *
 * Submission state is local to this component because it never coordinates
 * with other overlays or surfaces: the only caller is Radix (open/close) and
 * the only consumer of `loading` is the same component's `UiConfirmDialog`.
 * This is not an overlay-state `useState` — that would be a store; this is
 * per-request UX state (spinner / disable cancel).
 */
export default function AvatarDeleteConfirmDialog() {
    const isOpen = useAvatarDeleteConfirmDialogStore((s) => s.isOpen);
    const close = useAvatarDeleteConfirmDialogStore((s) => s.close);

    const user = useAuthStore((s) => s.user);
    const setUser = useAuthStore((s) => s.setUser);

    const [submitting, setSubmitting] = useState(false);

    const handleOpenChange = (open: boolean) => {
        if (open) return;
        if (submitting) return;
        close();
    };

    const handleConfirm = async () => {
        if (submitting || !user) return;
        setSubmitting(true);
        try {
            await deleteAvatar();
            setUser({
                ...user,
                profile: { ...user.profile, avatar: undefined },
            });
            toast.success('Фото видалено');
            close();
        } catch {
            toast.error('Не вдалося завантажити фото. Спробуйте пізніше');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={handleOpenChange}
            onConfirm={handleConfirm}
            title="Видалити фото профілю?"
            description="Замість фото відображатимуться ініціали"
            confirmLabel="Видалити"
            cancelLabel="Скасувати"
            variant="destructive"
            loading={submitting}
        />
    );
}
