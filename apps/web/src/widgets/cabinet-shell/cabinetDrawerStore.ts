import { create } from 'zustand';

interface CabinetDrawerState {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

export const useCabinetDrawerStore = create<CabinetDrawerState>((set) => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
}));
