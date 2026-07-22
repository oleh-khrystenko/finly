import { create } from 'zustand';

interface BrandProrationConfirmState {
    isOpen: boolean;
    /** Отримувач, що атомарно заповнює новий слот на успіху доплати. */
    businessId: string | null;
    /** Нова ємність Бренд-складу після додавання слота. */
    newCapacity: number;
    /** Негайна пропорційна доплата за дні до кінця циклу, копійки. */
    immediateCharge: number;
    /** Нове місячне списання після розширення, копійки. */
    newMonthlyAmount: number;
    currency: string;
    /** Перезавантаження білінг-профілю після успішної доплати. */
    onDone: (() => void) | null;
    open: (payload: {
        businessId: string;
        newCapacity: number;
        immediateCharge: number;
        newMonthlyAmount: number;
        currency: string;
        onDone: () => void;
    }) => void;
    close: () => void;
}

export const useBrandProrationConfirmStore = create<BrandProrationConfirmState>(
    (set) => ({
        isOpen: false,
        businessId: null,
        newCapacity: 0,
        immediateCharge: 0,
        newMonthlyAmount: 0,
        currency: 'UAH',
        onDone: null,
        open: (payload) => set({ isOpen: true, ...payload }),
        close: () => set({ isOpen: false }),
    })
);
