import { create } from 'zustand';

/**
 * Confirm-dialog store для скидання slug-у інвойсу (overlays.md §2 — in-slice
 * ownership). `onConfirm` closure (cabinet page) робить `resetInvoiceSlug` +
 * оновлення state + redirect на новий slug.
 */
interface State {
    isOpen: boolean;
    onConfirm: (() => void) | null;
    open: (onConfirm: () => void) => void;
    close: () => void;
}

export const useResetInvoiceSlugConfirmStore = create<State>((set) => ({
    isOpen: false,
    onConfirm: null,
    open: (onConfirm) => set({ isOpen: true, onConfirm }),
    close: () => set({ isOpen: false, onConfirm: null }),
}));
