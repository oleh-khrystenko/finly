import { create } from 'zustand';

interface BrandDecreaseConfirmState {
    isOpen: boolean;
    /** Нова ємність з наступного циклу (`0` — вимкнути всесвіт). */
    newCapacity: number;
    /** Прикріплення, що лишаються в межах нової ємності. */
    keepBusinessIds: string[];
    /** Нове місячне списання після зменшення, копійки. */
    newMonthlyAmount: number;
    currency: string;
    /** Перезавантаження білінг-профілю після запланованого зменшення. */
    onDone: (() => void) | null;
    open: (payload: {
        newCapacity: number;
        keepBusinessIds: string[];
        newMonthlyAmount: number;
        currency: string;
        onDone: () => void;
    }) => void;
    close: () => void;
}

export const useBrandDecreaseConfirmStore = create<BrandDecreaseConfirmState>(
    (set) => ({
        isOpen: false,
        newCapacity: 0,
        keepBusinessIds: [],
        newMonthlyAmount: 0,
        currency: 'UAH',
        onDone: null,
        open: (payload) => set({ isOpen: true, ...payload }),
        close: () => set({ isOpen: false }),
    })
);
