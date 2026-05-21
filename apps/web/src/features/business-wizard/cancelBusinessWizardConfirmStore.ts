import { create } from 'zustand';

/**
 * Confirm-dialog store для скасування wizard-у створення бізнесу. Slice-local
 * за `docs/conventions/overlays.md` §2 — store живе всередині `business-wizard`
 * feature-slice, не у глобальному `src/stores/`.
 *
 * Чому окремий store, а не inline-state у `BusinessWizardForm`: confirm-dialog
 * рендериться у `app/overlays.tsx` як global overlay (єдина точка mount-у
 * portal-ів), а тригериться з wizard-форми. Глобальний overlay + локальний
 * тригер => store як bridge.
 *
 * **Без `onConfirm`-closure у store** (на відміну від `deleteBusinessConfirmStore`):
 * cancel-logic не залежить від route-context — `reset()` wizard-у і
 * `clearAll()` landing-draft-у — це чисті side-effects на глобальних store-ах,
 * які dialog може виконати самостійно. `fromLanding`-флаг dialog читає
 * локально через `useSearchParams`.
 */
interface State {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

export const useCancelBusinessWizardConfirmStore = create<State>((set) => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
}));
