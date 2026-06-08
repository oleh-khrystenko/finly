import { create } from 'zustand';

interface CancelSubscriptionDialogState {
    isOpen: boolean;
    /** Межа поточного періоду — для копії «активна до …». */
    currentPeriodEnd: string | null;
    open: (currentPeriodEnd: string | null) => void;
    close: () => void;
}

export const useCancelSubscriptionDialogStore =
    create<CancelSubscriptionDialogState>((set) => ({
        isOpen: false,
        currentPeriodEnd: null,
        open: (currentPeriodEnd) => set({ isOpen: true, currentPeriodEnd }),
        close: () => set({ isOpen: false }),
    }));
