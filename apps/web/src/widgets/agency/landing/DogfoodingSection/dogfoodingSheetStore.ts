import { create } from 'zustand';

export type ProofTabKey = 'auth' | 'billing' | 'usage';

interface DogfoodingSheetState {
    activeTab: ProofTabKey | null;
    setActiveTab: (tab: ProofTabKey | null) => void;
}

export const useDogfoodingSheetStore = create<DogfoodingSheetState>((set) => ({
    activeTab: null,
    setActiveTab: (activeTab) => set({ activeTab }),
}));
