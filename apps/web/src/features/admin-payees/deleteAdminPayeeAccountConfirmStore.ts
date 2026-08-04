import { create } from 'zustand';

/**
 * Sprint 29 — confirm-store для видалення реквізитів системного отримувача.
 * Власник: admin-payees slice (overlays.md §2 — in-slice ownership).
 *
 * Лічильника вкладеного тут немає навмисно: системний отримувач не виставляє
 * документів, тож піддерева під реквізитами не існує і gate-підтвердження не
 * потрібне (ui-primitives.md — `UiDangerGateDialog` саме для каскаду).
 *
 * API-виклик робить не діалог, а `onConfirm` зі сторінки отримувача, яка після
 * видалення перечитує список.
 */
interface State {
    isOpen: boolean;
    accountLabel: string;
    onConfirm: (() => void) | null;
    open: (accountLabel: string, onConfirm: () => void) => void;
    close: () => void;
}

export const useDeleteAdminPayeeAccountConfirmStore = create<State>((set) => ({
    isOpen: false,
    accountLabel: '',
    onConfirm: null,
    open: (accountLabel, onConfirm) =>
        set({ isOpen: true, accountLabel, onConfirm }),
    close: () => set({ isOpen: false, accountLabel: '', onConfirm: null }),
}));
