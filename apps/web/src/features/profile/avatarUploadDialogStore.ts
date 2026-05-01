import { create } from 'zustand';

interface AvatarUploadDialogState {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

/**
 * In-slice dialog store for the avatar upload flow. Owned by `features/profile`;
 * the profile page opens this store directly (same slice).
 */
export const useAvatarUploadDialogStore = create<AvatarUploadDialogState>(
    (set) => ({
        isOpen: false,
        open: () => set({ isOpen: true }),
        close: () => set({ isOpen: false }),
    })
);
