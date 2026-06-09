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
 * **`accountsCount` + `invoicesCount`** керують cascade-gate у dialog-і: коли
 * є вкладене, кнопка "Видалити" розблоковується лише після того, як ФОП вписав
 * відповідні цифри (ненульові з пари). Cascade-delete зносить усі реквізити і
 * рахунки разом з бізнесом у одній transaction; gate робить масштаб втрати
 * усвідомленим. Лічильники у `BusinessWithCounts` (single aggregation list).
 */
interface State {
    isOpen: boolean;
    business: Business | null;
    accountsCount: number;
    invoicesCount: number;
    onConfirm: (() => void) | null;
    open: (
        business: Business,
        accountsCount: number,
        invoicesCount: number,
        onConfirm: () => void
    ) => void;
    close: () => void;
}

export const useDeleteBusinessConfirmStore = create<State>((set) => ({
    isOpen: false,
    business: null,
    accountsCount: 0,
    invoicesCount: 0,
    onConfirm: null,
    open: (business, accountsCount, invoicesCount, onConfirm) =>
        set({ isOpen: true, business, accountsCount, invoicesCount, onConfirm }),
    close: () =>
        set({
            isOpen: false,
            business: null,
            accountsCount: 0,
            invoicesCount: 0,
            onConfirm: null,
        }),
}));
