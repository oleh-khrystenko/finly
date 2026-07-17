import { create } from 'zustand';

interface DeleteGuideDialogState {
    isOpen: boolean;
    guideId: string | null;
    guideTitle: string;
    open: (guideId: string, guideTitle: string) => void;
    close: () => void;
}

export const useDeleteGuideDialogStore = create<DeleteGuideDialogState>(
    (set) => ({
        isOpen: false,
        guideId: null,
        guideTitle: '',
        open: (guideId, guideTitle) =>
            set({ isOpen: true, guideId, guideTitle }),
        close: () => set({ isOpen: false, guideId: null, guideTitle: '' }),
    })
);
