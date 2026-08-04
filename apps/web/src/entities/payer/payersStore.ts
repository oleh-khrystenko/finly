import { create } from 'zustand';
import type { PayerView } from '@finly/types';

import { listPayers } from '@/shared/api';
import { authEvents } from '@/shared/lib';

interface PayersState {
    payers: PayerView[];
    isLoading: boolean;
    /** Список уже завантажували у цій сесії сторінки (навіть якщо він порожній). */
    isLoaded: boolean;
    /** Завантажити список один раз; повторний виклик — no-op. */
    load: () => Promise<void>;
    /** Перезавантажити примусово (після зовнішньої зміни). */
    reload: () => Promise<void>;
    /** Додати або замінити запис після збереження. */
    upsert: (payer: PayerView) => void;
    remove: (id: string) => void;
    /** Скинути стан на виході з акаунта — це персональні дані. */
    clear: () => void;
}

/**
 * Sprint 30 — список платників живе в одному місці на обидві поверхні: секція
 * профілю (керування) і податкова сторінка (вибір, за кого платимо). Спільний
 * стор замість двох незалежних завантажень означає, що доданий на сторінці
 * оплати платник одразу видно у профілі і навпаки, без перезавантаження.
 */
export const usePayersStore = create<PayersState>((set, get) => ({
    payers: [],
    isLoading: false,
    isLoaded: false,
    load: async () => {
        if (get().isLoaded || get().isLoading) return;
        await get().reload();
    },
    reload: async () => {
        set({ isLoading: true });
        try {
            const payers = await listPayers();
            set({ payers, isLoaded: true });
        } finally {
            set({ isLoading: false });
        }
    },
    upsert: (payer) =>
        set((state) => {
            const index = state.payers.findIndex((p) => p.id === payer.id);
            if (index === -1) return { payers: [payer, ...state.payers] };
            const payers = [...state.payers];
            payers[index] = payer;
            return { payers };
        }),
    remove: (id) =>
        set((state) => ({ payers: state.payers.filter((p) => p.id !== id) })),
    clear: () => set({ payers: [], isLoaded: false, isLoading: false }),
}));

// Сесія зникла (прострочений refresh, вихід в іншій вкладці) — прибираємо
// завантажені персональні дані третіх осіб з пам'яті вкладки, не чекаючи
// перезавантаження сторінки. Той самий інверсійний патерн, що в `authStore`:
// нижчий шар публікує подію, доменний шар на неї реагує.
authEvents.on('session-lost', () => {
    usePayersStore.getState().clear();
});
