import { useQrLandingDraftStore } from './store';

/**
 * Sprint 10 §10.2 — submit-handler-side gate, що чекає завершення
 * Zustand-`persist`-hydrate перед читанням `getState()`.
 *
 * **Чому потрібно поза render-циклом**: Sprint 10 явно вимагає, що signin-page
 * (входова точка для всіх користувачів, render не блокується hydration-gate-ом)
 * читає `qrLandingDraftStore` саме у submit-handler-і. На повільному first-load
 * (low-end mobile, slow storage) `localStorage`-hydrate може не встигнути до
 * моменту submit; тоді `getState()` повертає `INITIAL_STATE` замість
 * persisted-snapshot-у. Magic-link піде без `landingDraft + claimIdempotencyKey`
 * → backend не виконує claim → cross-device flow деградує.
 *
 * **Implementation**: симетрично render-side `useHasHydrated`-hook-у. Якщо
 * hydration вже завершено — resolve миттєво; інакше підписка на
 * `onFinishHydration` з cleanup після першого fire-у.
 */
export function awaitLandingDraftHydration(): Promise<void> {
    if (useQrLandingDraftStore.persist.hasHydrated()) {
        return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
        const unsub = useQrLandingDraftStore.persist.onFinishHydration(() => {
            unsub();
            resolve();
        });
    });
}
