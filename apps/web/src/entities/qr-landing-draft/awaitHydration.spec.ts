import { awaitLandingDraftHydration } from './awaitHydration';
import { useQrLandingDraftStore } from './store';

describe('awaitLandingDraftHydration', () => {
    beforeEach(() => {
        useQrLandingDraftStore.getState().clearAll();
        localStorage.clear();
    });

    it('hasHydrated() === true → resolve миттєво (Promise.resolve fast-path)', async () => {
        // Тест-середовище: store-instance вже rehydrate-ився на першому
        // import-і; persist.hasHydrated() повертає true.
        expect(useQrLandingDraftStore.persist.hasHydrated()).toBe(true);

        const start = Date.now();
        await awaitLandingDraftHydration();
        // Менше за 50ms — sanity-check, що ми не пішли через subscribe-flow
        // (який вимагав би manual hydration trigger).
        expect(Date.now() - start).toBeLessThan(50);
    });

    it('await unblock-ує, коли спрацьовує onFinishHydration', async () => {
        // Симулюємо pre-hydrate-стан через перевизначення `hasHydrated` +
        // emit `onFinishHydration` вручну. Це eq до повільного first-load,
        // де submit-handler стартує до завершення persist.
        const realHasHydrated = useQrLandingDraftStore.persist.hasHydrated;
        let listener: (() => void) | null = null;
        useQrLandingDraftStore.persist.hasHydrated = () => false;
        const realOnFinish = useQrLandingDraftStore.persist.onFinishHydration;
        useQrLandingDraftStore.persist.onFinishHydration = ((
            cb: () => void
        ) => {
            listener = cb;
            return () => {
                listener = null;
            };
        }) as typeof realOnFinish;

        try {
            const promise = awaitLandingDraftHydration();
            let resolved = false;
            void promise.then(() => {
                resolved = true;
            });

            // Поки listener не fire-нув — promise не resolved.
            await new Promise((r) => setTimeout(r, 10));
            expect(resolved).toBe(false);

            // Тригеримо hydration-finish.
            listener!();

            await promise;
            expect(resolved).toBe(true);
        } finally {
            useQrLandingDraftStore.persist.hasHydrated = realHasHydrated;
            useQrLandingDraftStore.persist.onFinishHydration = realOnFinish;
        }
    });
});
