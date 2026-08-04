import { create } from 'zustand';

import { adminListPublicityQueue } from '@/shared/api';

/**
 * Лічильник заявок на публічність, спільний між таб-баром каталогу і чергою.
 * Таб-бар показує число на табі «Запити» з обох сторінок; черга оновлює його
 * після схвалення/відхилення (`setCount`), тож бейдж лишається живим без
 * повторного походу в мережу. `refresh` тягне значення там, де черги нема
 * (сторінка «Отримувачі»).
 */
interface State {
    /** `null` — ще не завантажено; бейдж ховаємо. */
    count: number | null;
    setCount: (n: number) => void;
    refresh: () => Promise<void>;
}

export const usePublicityCountStore = create<State>((set) => ({
    count: null,
    setCount: (n) => set({ count: n }),
    refresh: async () => {
        try {
            const queue = await adminListPublicityQueue();
            set({ count: queue.length });
        } catch {
            // Тиха помилка: бейдж просто лишається як є, це не критична поверхня.
        }
    },
}));
