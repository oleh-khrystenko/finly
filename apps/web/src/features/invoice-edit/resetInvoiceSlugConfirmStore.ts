import { create } from 'zustand';
import type { AutoSlugMode } from '@finly/types';

/**
 * Confirm-dialog store для скидання slug-у інвойсу (overlays.md §2 — in-slice
 * ownership). `onConfirm` отримує обраний у діалозі формат (one-time override);
 * closure (cabinet page) робить `resetInvoiceSlug(mode)` + оновлення state +
 * redirect на новий slug. `defaultMode` — «домашній формат» рахунку, яким picker
 * відкривається (Sprint 17 §billing-design).
 */
interface State {
    isOpen: boolean;
    defaultMode: AutoSlugMode | null;
    onConfirm: ((mode: AutoSlugMode) => void) | null;
    open: (params: {
        defaultMode: AutoSlugMode | null;
        onConfirm: (mode: AutoSlugMode) => void;
    }) => void;
    close: () => void;
}

export const useResetInvoiceSlugConfirmStore = create<State>((set) => ({
    isOpen: false,
    defaultMode: null,
    onConfirm: null,
    open: ({ defaultMode, onConfirm }) =>
        set({ isOpen: true, defaultMode, onConfirm }),
    close: () => set({ isOpen: false, defaultMode: null, onConfirm: null }),
}));
