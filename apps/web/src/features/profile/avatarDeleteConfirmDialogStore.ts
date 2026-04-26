import { create } from 'zustand';

interface AvatarDeleteConfirmDialogState {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

/**
 * In-slice confirm-dialog store for avatar removal. Separate from the upload
 * dialog store (and the upload dialog itself) so the two overlays live as
 * sequential, never nested — the upload modal closes before this one opens,
 * keeping a single active overlay at any moment per overlays.md Rule 7.
 */
export const useAvatarDeleteConfirmDialogStore =
    create<AvatarDeleteConfirmDialogState>((set) => ({
        isOpen: false,
        open: () => set({ isOpen: true }),
        close: () => set({ isOpen: false }),
    }));
