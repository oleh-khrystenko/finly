import { create } from 'zustand';
import type { Account } from '@finly/types';

/**
 * Confirm-dialog store для account-delete-flow. Власник: account-edit slice.
 *
 * **Контракт.** Confirm-dialog НЕ виконує API-call. На confirm callback
 * передається у `onConfirm` (closure з cabinet page), що запускає
 * `scheduleAccountDeleteWithUndo(...)` (5s undo + actual cascade-DELETE).
 *
 * **`invoicesCount`** приходить з вже-fetched `AccountWithCounts`-shape і керує
 * виглядом dialog-у: `> 0` → gate-поле (ввести цю цифру, щоб підтвердити
 * cascade-видалення вкладених рахунків); `=== 0` → простий confirm.
 */
interface State {
    isOpen: boolean;
    account: Account | null;
    invoicesCount: number;
    onConfirm: (() => void) | null;
    open: (
        account: Account,
        invoicesCount: number,
        onConfirm: () => void
    ) => void;
    close: () => void;
}

export const useDeleteAccountConfirmStore = create<State>((set) => ({
    isOpen: false,
    account: null,
    invoicesCount: 0,
    onConfirm: null,
    open: (account, invoicesCount, onConfirm) =>
        set({ isOpen: true, account, invoicesCount, onConfirm }),
    close: () =>
        set({
            isOpen: false,
            account: null,
            invoicesCount: 0,
            onConfirm: null,
        }),
}));
