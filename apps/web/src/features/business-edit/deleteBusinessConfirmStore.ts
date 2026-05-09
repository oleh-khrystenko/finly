import { create } from 'zustand';
import type { Business } from '@finly/types';

/**
 * Sprint 3 §3.8 §C2 + §F8 + Sprint 4 §SP-5 — confirm-dialog store для
 * delete-flow. Власник: business-edit slice (overlays.md §2 — in-slice
 * ownership).
 *
 * Важливо: confirm-dialog НЕ виконує `DELETE` API call. На confirm callback
 * передається у `onConfirm` (closure з cabinet page), що:
 *  1. Закриває dialog.
 *  2. Optimistically прибирає бізнес з UI.
 *  3. Показує toast з 5s-таймером + cancel button.
 *  4. На таймер — фактичний `deleteBusiness(slug)` API call.
 *  5. На cancel — повернути бізнес у UI (немає request взагалі).
 *
 * **Sprint 4 §SP-5 — `invoicesCount`** показується у dialog-warning, якщо
 * `> 0`: "У бізнесу N активних рахунків — вони теж зникнуть". ФОП знає
 * цифру **до** натискання "Видалити" (cascade-delete видалить усі invoices
 * разом з business у одній transaction). Counter вже у `BusinessWithInvoicesCount`-
 * type після §4.4 розширення `getBySlug` response.
 */
interface State {
    isOpen: boolean;
    business: Business | null;
    invoicesCount: number;
    onConfirm: (() => void) | null;
    open: (
        business: Business,
        invoicesCount: number,
        onConfirm: () => void
    ) => void;
    close: () => void;
}

export const useDeleteBusinessConfirmStore = create<State>((set) => ({
    isOpen: false,
    business: null,
    invoicesCount: 0,
    onConfirm: null,
    open: (business, invoicesCount, onConfirm) =>
        set({ isOpen: true, business, invoicesCount, onConfirm }),
    close: () =>
        set({
            isOpen: false,
            business: null,
            invoicesCount: 0,
            onConfirm: null,
        }),
}));
