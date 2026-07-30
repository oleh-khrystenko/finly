import { create } from 'zustand';
import type { PayerSource } from '@finly/types';

import { listPayerSources } from '@/shared/api';
import { authEvents } from '@/shared/lib';

interface PayerSourcesState {
    sources: PayerSource[];
    isLoading: boolean;
    /** Джерела вже завантажували у цій сесії сторінки (навіть якщо порожньо). */
    isLoaded: boolean;
    /** Завантажити один раз; повторний виклик — no-op. */
    load: () => Promise<void>;
    /** Скинути стан на виході з акаунта. */
    clear: () => void;
}

/**
 * Sprint 30 — отримувачі-фізособи користувача як джерело даних платника.
 * Окремий стор від списку платників: там колекція під керуванням користувача
 * (створення, редагування, видалення), тут — проєкція чужої сутності лише на
 * читання. Спільний стор змішав би два життєві цикли і дав би спокусу
 * «дописати» джерело, якого не існує.
 */
export const usePayerSourcesStore = create<PayerSourcesState>((set, get) => ({
    sources: [],
    isLoading: false,
    isLoaded: false,
    load: async () => {
        if (get().isLoaded || get().isLoading) return;
        set({ isLoading: true });
        try {
            const sources = await listPayerSources();
            set({ sources, isLoaded: true });
        } finally {
            set({ isLoading: false });
        }
    },
    clear: () => set({ sources: [], isLoaded: false, isLoading: false }),
}));

// Сесія зникла — прибираємо завантажені дані (серед клієнтських отримувачів
// бухгалтера це персональні дані третіх осіб), не чекаючи перезавантаження
// сторінки. Той самий інверсійний патерн, що у `payersStore`.
authEvents.on('session-lost', () => {
    usePayerSourcesStore.getState().clear();
});
