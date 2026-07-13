import { create } from 'zustand';

interface BrandDetachConfirmState {
    isOpen: boolean;
    businessId: string | null;
    businessName: string;
    /** Перезавантаження білінг-профілю після успішного відкріплення. */
    onDone: (() => void) | null;
    open: (payload: {
        businessId: string;
        businessName: string;
        onDone: () => void;
    }) => void;
    close: () => void;
}

export const useBrandDetachConfirmStore = create<BrandDetachConfirmState>(
    (set) => ({
        isOpen: false,
        businessId: null,
        businessName: '',
        onDone: null,
        open: (payload) => set({ isOpen: true, ...payload }),
        close: () => set({ isOpen: false }),
    })
);
