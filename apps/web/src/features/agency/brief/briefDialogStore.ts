import { create } from 'zustand';

import { uiIntents } from '@/shared/lib';

interface BriefDialogOpenOptions {
    requestAiBonus?: boolean;
}

interface BriefDialogState {
    isOpen: boolean;
    requestAiBonus: boolean;
    open: (opts?: BriefDialogOpenOptions) => void;
    close: () => void;
}

export const useBriefDialogStore = create<BriefDialogState>((set) => ({
    isOpen: false,
    requestAiBonus: false,
    open: (opts) =>
        set({ isOpen: true, requestAiBonus: opts?.requestAiBonus ?? false }),
    close: () => set({ isOpen: false, requestAiBonus: false }),
}));

// Cross-slice intent: core (e.g. ai-chat page) requests the brief dialog
// to open without importing this agency-owned store directly. The
// subscription lives for the process lifetime — `app/overlays.tsx`
// dynamically mounts the brief dialog on every page load, which causes
// this module to be loaded shortly after hydration and the listener to
// be registered before the user can trigger any intent.
uiIntents.on('open-brief-dialog', (payload) => {
    useBriefDialogStore.getState().open(payload);
});
