import { create } from 'zustand';

/**
 * Confirm-dialog store для скидання slug-у бізнесу (overlays.md §2 — in-slice
 * ownership). Dialog не виконує API call — `onConfirm` closure (cabinet page)
 * робить `resetBusinessSlug` + оновлення state + redirect на новий slug.
 */
interface State {
    isOpen: boolean;
    onConfirm: (() => void) | null;
    open: (onConfirm: () => void) => void;
    close: () => void;
}

export const useResetBusinessSlugConfirmStore = create<State>((set) => ({
    isOpen: false,
    onConfirm: null,
    open: (onConfirm) => set({ isOpen: true, onConfirm }),
    close: () => set({ isOpen: false, onConfirm: null }),
}));
