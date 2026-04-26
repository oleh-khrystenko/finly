import { create } from 'zustand';

interface BillingResetDialogState {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

export const useBillingResetDialogStore = create<BillingResetDialogState>(
    (set) => ({
        isOpen: false,
        open: () => set({ isOpen: true }),
        close: () => set({ isOpen: false }),
    })
);
