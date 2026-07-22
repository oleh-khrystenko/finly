import { create } from 'zustand';

/**
 * Sprint 29 — confirm-store для каскадного видалення системного отримувача.
 * Власник: admin-payees slice (overlays.md §2 — in-slice ownership).
 *
 * Діалог не робить API-виклик сам: на підтвердження виконується `onConfirm`
 * (closure зі сторінки отримувача), яка видаляє запис і веде до списку. Так
 * само влаштовані кабінетні delete-flow бізнесу і реквізитів.
 *
 * `accountsCount` керує виглядом: ненульове значення вмикає gate-поле, у яке
 * адмін вписує кількість реквізитів, що зникнуть разом з отримувачем.
 */
interface State {
    isOpen: boolean;
    payeeName: string;
    accountsCount: number;
    onConfirm: (() => void) | null;
    open: (
        payeeName: string,
        accountsCount: number,
        onConfirm: () => void
    ) => void;
    close: () => void;
}

export const useDeleteAdminPayeeConfirmStore = create<State>((set) => ({
    isOpen: false,
    payeeName: '',
    accountsCount: 0,
    onConfirm: null,
    open: (payeeName, accountsCount, onConfirm) =>
        set({ isOpen: true, payeeName, accountsCount, onConfirm }),
    close: () =>
        set({
            isOpen: false,
            payeeName: '',
            accountsCount: 0,
            onConfirm: null,
        }),
}));
