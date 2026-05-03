import { create } from 'zustand';
import type { Business } from '@finly/types';

/**
 * Sprint 3 §3.8 §C2 + §F8 — confirm-dialog store для delete-flow.
 * Власник: business-edit slice (overlays.md §2 — in-slice ownership).
 *
 * Важливо: confirm-dialog НЕ виконує `DELETE` API call. На confirm callback
 * передається у `onConfirm` (closure з cabinet page), що:
 *  1. Закриває dialog.
 *  2. Optimistically прибирає бізнес з UI.
 *  3. Показує toast з 5s-таймером + cancel button.
 *  4. На таймер — фактичний `deleteBusiness(slug)` API call.
 *  5. На cancel — повернути бізнес у UI (немає request взагалі).
 */
interface State {
    isOpen: boolean;
    business: Business | null;
    onConfirm: (() => void) | null;
    open: (business: Business, onConfirm: () => void) => void;
    close: () => void;
}

export const useDeleteBusinessConfirmStore = create<State>((set) => ({
    isOpen: false,
    business: null,
    onConfirm: null,
    open: (business, onConfirm) => set({ isOpen: true, business, onConfirm }),
    close: () => set({ isOpen: false, business: null, onConfirm: null }),
}));
