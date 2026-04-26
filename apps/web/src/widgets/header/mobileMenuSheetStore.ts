import { create } from 'zustand';

interface MobileMenuSheetState {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

export const useMobileMenuSheetStore = create<MobileMenuSheetState>((set) => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
}));
