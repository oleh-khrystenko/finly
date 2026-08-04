import { create } from 'zustand';

interface PayerDeleteDialogState {
    isOpen: boolean;
    payerId: string | null;
    payerName: string;
    open: (payerId: string, payerName: string) => void;
    close: () => void;
}

export const usePayerDeleteDialogStore = create<PayerDeleteDialogState>(
    (set) => ({
        isOpen: false,
        payerId: null,
        payerName: '',
        open: (payerId, payerName) => set({ isOpen: true, payerId, payerName }),
        close: () => set({ isOpen: false, payerId: null, payerName: '' }),
    })
);
