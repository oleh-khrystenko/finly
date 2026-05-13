import { useSyncExternalStore } from 'react';

/**
 * Hook, що повертає `true` після того як Zustand `persist`-middleware закінчив
 * гідратувати store з localStorage / sessionStorage.
 *
 * Zustand `persist` гідратує асинхронно після першого render. Якщо компонент
 * читає store-snapshot на mount (через `getState()`) і кешує у RHF
 * `defaultValues` / `useState`-init — він бачить **порожній initial-state**, не
 * persisted-data. Render-gate на hasHydrated() мусить блокувати критичну
 * частину UI до завершення hydration.
 *
 * `useSyncExternalStore` (а не `useState + useEffect`):
 *  1. SSR-safe by design — `getServerSnapshot = false` детерміністично, без
 *     читання `store.persist` (який undefined у Next.js prerender bundle).
 *  2. Канонічний hook для зовнішніх підписок; не тригерить
 *     `react-hooks/set-state-in-effect` ESLint-warning.
 *
 * Sprint 10 §10.2 — generic move з `features/qr-landing-preview/lib/` у
 * `shared/lib/`, бо тепер потрібен на трьох callsite-ах:
 *  - `QrLandingBlock` (Sprint 8 baseline)
 *  - `business/new/page.tsx` (`?from=landing` pre-fill)
 *  - `business/[slug]/account/new/page.tsx` (`?from=landing` pre-fill)
 */
interface PersistedStore {
    persist: {
        hasHydrated: () => boolean;
        onFinishHydration: (cb: () => void) => () => void;
    };
}

export function useHasHydrated(store: PersistedStore): boolean {
    return useSyncExternalStore(
        (callback) => {
            // Defensive — `store.persist` undefined у edge SSR-bundling
            // сценаріях. No-op unsubscribe замість crash.
            if (!store.persist) return () => {};
            return store.persist.onFinishHydration(callback);
        },
        () => store.persist?.hasHydrated() ?? false,
        () => false
    );
}
