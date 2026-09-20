import { create } from 'zustand';

interface CardChangeConfirmState {
    isOpen: boolean;
    /** Сума, яку спишемо одразу після збереження картки (копійки). */
    chargeAfterSave: number;
    currency: string;
    /** Перехід на сторінку банку після згоди. */
    onConfirm: (() => void) | null;
    open: (payload: {
        chargeAfterSave: number;
        currency: string;
        onConfirm: () => void;
    }) => void;
    close: () => void;
}

export const useCardChangeConfirmStore = create<CardChangeConfirmState>(
    (set) => ({
        isOpen: false,
        chargeAfterSave: 0,
        currency: 'UAH',
        onConfirm: null,
        open: (payload) => set({ isOpen: true, ...payload }),
        close: () => set({ isOpen: false }),
    })
);
