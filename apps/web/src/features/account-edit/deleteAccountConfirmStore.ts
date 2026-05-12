import { create } from 'zustand';
import type { Account } from '@finly/types';

/**
 * Sprint 9 §9.2 — confirm-dialog store для account-delete-flow. Той самий
 * patern, що Sprint 3 `useDeleteBusinessConfirmStore` і Sprint 4
 * `useDeleteInvoiceConfirmStore`. Власник: account-edit slice.
 *
 * **Контракт.** Confirm-dialog НЕ виконує API-call. На confirm callback
 * передається у `onConfirm` (closure з cabinet page), що:
 *   1. Закриває dialog.
 *   2. Frontend pre-check `invoicesCount > 0` (Sprint 9 §SP-3 first line of defense)
 *      → toast.error(ACCOUNT_HAS_INVOICES) без 5s-timer і без actual delete-call-у.
 *   3. На `=== 0` → `scheduleAccountDeleteWithUndo(...)` (5s undo + actual DELETE).
 *
 * **Без `invoicesCount` у store** — pre-check живе у callsite (cabinet page
 * / per-card AccountsSection), бо store глобальний і не може хранити стейт
 * конкретного account-page-у. `invoicesCount` приходить з вже-fetched
 * `AccountWithCounts`-shape.
 */
interface State {
    isOpen: boolean;
    account: Account | null;
    onConfirm: (() => void) | null;
    open: (account: Account, onConfirm: () => void) => void;
    close: () => void;
}

export const useDeleteAccountConfirmStore = create<State>((set) => ({
    isOpen: false,
    account: null,
    onConfirm: null,
    open: (account, onConfirm) => set({ isOpen: true, account, onConfirm }),
    close: () => set({ isOpen: false, account: null, onConfirm: null }),
}));
