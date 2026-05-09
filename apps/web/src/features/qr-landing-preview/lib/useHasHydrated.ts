import { useSyncExternalStore } from 'react';

/**
 * Sprint 8 §8.3 — hook, що повертає `true` після того як Zustand `persist`-
 * middleware закінчив гідратувати store з localStorage.
 *
 * **Чому потрібно**: Zustand `persist` гідратує асинхронно після першого
 * render-у. Якщо компонент читає store-snapshot на mount (через
 * `getState()`) і кешує у RHF `defaultValues`/`useState`-init, він бачить
 * **порожній initial-state**, не persisted-data. Sprint 8 UAT LAND-3
 * ("reload → форма відновлена з localStorage без миготіння") вимагає gate
 * перед render-ом форми.
 *
 * **Чому `useSyncExternalStore`, а не `useState + useEffect`**:
 *  1. **SSR-safe by design.** `getServerSnapshot` returns `false`
 *     детерміністично, без читання `store.persist` (який може бути
 *     недоступним у SSR-bundle). `useState + useEffect`-варіант падав
 *     `TypeError: Cannot read properties of undefined (reading
 *     'hasHydrated')` на Next.js prerender (`store.persist` API не
 *     ініціалізований у server bundle).
 *  2. **React-pure** — useState-в-useEffect тригерить `react-hooks/set-
 *     state-in-effect` ESLint rule (React 19.1+ enforce). useSyncExternalStore
 *     є канонічним hook-ом для зовнішніх підписок саме під цей use-case.
 *
 * **Generic shape `{ persist: ... }`**: hook працює з будь-яким Zustand-
 * store, що використовує `persist`-middleware. Експонується з
 * `features/qr-landing-preview/lib/`, бо його єдиний consumer на Sprint 8 —
 * `QrLandingBlock`. Якщо інший feature потребуватиме того самого pattern —
 * переноситься у `shared/lib/` без зміни API.
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
            // `store.persist` може бути недоступний у edge-cases SSR-
            // bundling (Next.js routing-helper-imports). Defensive — повертаємо
            // no-op unsubscribe замість crash.
            if (!store.persist) return () => {};
            return store.persist.onFinishHydration(callback);
        },
        () => store.persist?.hasHydrated() ?? false,
        () => false // server snapshot — ніщо не hydrated на SSR-render
    );
}
