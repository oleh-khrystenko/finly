import { create } from 'zustand';
import type { AccountDeletionPreview } from '@finly/types';

/**
 * Sprint 32 — модалка видалення акаунта відкривається вже з переліком того, що
 * зникне: небезпечна зона тягне його ДО відкриття, бо від нього залежить і
 * запобіжник (кількості), і крок підтвердження (пароль чи лист).
 */
interface DeleteAccountDialogState {
    isOpen: boolean;
    preview: AccountDeletionPreview | null;
    open: (preview: AccountDeletionPreview) => void;
    close: () => void;
}

export const useDeleteAccountDialogStore = create<DeleteAccountDialogState>(
    (set) => ({
        isOpen: false,
        preview: null,
        open: (preview) => set({ isOpen: true, preview }),
        close: () => set({ isOpen: false, preview: null }),
    })
);
