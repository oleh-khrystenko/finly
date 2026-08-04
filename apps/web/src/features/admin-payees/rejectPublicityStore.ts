import { create } from 'zustand';

/**
 * Sprint 29 — store діалогу відхилення запиту на публічність (overlays.md §2 —
 * in-slice ownership). Несе slug отримувача і callback-оновлення черги; сам API
 * call робить діалог (він володіє полем причини).
 */
/**
 * Два режими однієї дії: `pending` — відхилити заявку на розгляді; `approved` —
 * забрати схвалення у того, хто вже в каталозі. Ендпоінт один, копія різна, бо
 * для користувача це різні події.
 */
type RejectPublicityMode = 'pending' | 'approved';

interface State {
    isOpen: boolean;
    slug: string | null;
    payeeName: string;
    mode: RejectPublicityMode;
    onRejected: (() => void) | null;
    open: (payload: {
        slug: string;
        payeeName: string;
        mode: RejectPublicityMode;
        onRejected: () => void;
    }) => void;
    close: () => void;
}

export const useRejectPublicityStore = create<State>((set) => ({
    isOpen: false,
    slug: null,
    payeeName: '',
    mode: 'pending',
    onRejected: null,
    open: ({ slug, payeeName, mode, onRejected }) =>
        set({ isOpen: true, slug, payeeName, mode, onRejected }),
    close: () =>
        set({
            isOpen: false,
            slug: null,
            payeeName: '',
            mode: 'pending',
            onRejected: null,
        }),
}));
