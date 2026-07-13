import { create } from 'zustand';

interface PickerBusiness {
    id: string;
    name: string;
}

interface BrandPickerDialogState {
    isOpen: boolean;
    businesses: PickerBusiness[];
    /**
     * Обробник вибору — викликається ПІСЛЯ закриття пікера, подальший флоу
     * (безкоштовний слот / доплата / перший checkout) вирішує картка.
     */
    onPick: ((businessId: string) => void) | null;
    open: (payload: {
        businesses: PickerBusiness[];
        onPick: (businessId: string) => void;
    }) => void;
    close: () => void;
}

export const useBrandPickerDialogStore = create<BrandPickerDialogState>(
    (set) => ({
        isOpen: false,
        businesses: [],
        onPick: null,
        open: ({ businesses, onPick }) =>
            set({ isOpen: true, businesses, onPick }),
        close: () => set({ isOpen: false }),
    })
);
