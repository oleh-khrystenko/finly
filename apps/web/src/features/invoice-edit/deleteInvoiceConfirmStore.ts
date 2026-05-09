import { create } from 'zustand';
import type { Invoice } from '@finly/types';

/**
 * Sprint 4 §4.6 — confirm-dialog store для invoice-delete-flow. Той самий
 * patern, що Sprint 3 §3.8 §C2 `useDeleteBusinessConfirmStore`. Власник:
 * `invoice-edit` slice (overlays.md §2 — in-slice ownership).
 *
 * **Контракт.** Confirm-dialog НЕ виконує API-call. На confirm callback
 * передається у `onConfirm` (closure з cabinet page), що:
 *   1. Закриває dialog.
 *   2. Запускає `scheduleInvoiceDeleteWithUndo` з 5s-undo toast.
 *   3. На таймер — фактичний `deleteInvoice` API call.
 *   4. На cancel у toast — повернути на cabinet (closure resolves через
 *      `onCancelled`).
 *
 * **Чому 2-тапи (modal + 5s-undo) для invoice**: consistency з Sprint 3
 * cabinet-business-flow. Single-click destructive action — anti-pattern;
 * клієнт може випадково клацнути на "Видалити" і втратити slug посилання,
 * яке поширив. Modal — first guardrail, undo — recovery-window.
 */
interface State {
    isOpen: boolean;
    invoice: Invoice | null;
    onConfirm: (() => void) | null;
    open: (invoice: Invoice, onConfirm: () => void) => void;
    close: () => void;
}

export const useDeleteInvoiceConfirmStore = create<State>((set) => ({
    isOpen: false,
    invoice: null,
    onConfirm: null,
    open: (invoice, onConfirm) => set({ isOpen: true, invoice, onConfirm }),
    close: () => set({ isOpen: false, invoice: null, onConfirm: null }),
}));
