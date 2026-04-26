import { create } from 'zustand';

interface TermsReacceptDialogState {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

export const useTermsReacceptDialogStore = create<TermsReacceptDialogState>(
    (set) => ({
        isOpen: false,
        open: () => set({ isOpen: true }),
        close: () => set({ isOpen: false }),
    })
);
