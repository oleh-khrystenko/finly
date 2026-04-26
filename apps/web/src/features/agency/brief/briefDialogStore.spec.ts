import { uiIntents } from '@/shared/lib';

import { useBriefDialogStore } from './briefDialogStore';

describe('briefDialogStore', () => {
    beforeEach(() => {
        useBriefDialogStore.setState({
            isOpen: false,
            requestAiBonus: false,
        });
    });

    it('open() with no options sets isOpen=true and requestAiBonus=false', () => {
        useBriefDialogStore.getState().open();

        const state = useBriefDialogStore.getState();
        expect(state.isOpen).toBe(true);
        expect(state.requestAiBonus).toBe(false);
    });

    it('open({ requestAiBonus: true }) sets the bonus flag', () => {
        useBriefDialogStore.getState().open({ requestAiBonus: true });

        const state = useBriefDialogStore.getState();
        expect(state.isOpen).toBe(true);
        expect(state.requestAiBonus).toBe(true);
    });

    it('close() resets isOpen and clears the bonus flag', () => {
        useBriefDialogStore.getState().open({ requestAiBonus: true });
        useBriefDialogStore.getState().close();

        const state = useBriefDialogStore.getState();
        expect(state.isOpen).toBe(false);
        expect(state.requestAiBonus).toBe(false);
    });

    describe('uiIntents integration', () => {
        // The store subscribes to `open-brief-dialog` at module init.
        // These tests assert the cross-slice contract: emitting the
        // intent must drive the same state transition as calling open()
        // directly. This is the inversion that lets core/ai-chat open
        // the dialog without importing the agency feature.

        it('opens the dialog when uiIntents emits "open-brief-dialog"', () => {
            uiIntents.emit('open-brief-dialog', {});

            const state = useBriefDialogStore.getState();
            expect(state.isOpen).toBe(true);
            expect(state.requestAiBonus).toBe(false);
        });

        it('forwards the requestAiBonus payload from the intent', () => {
            uiIntents.emit('open-brief-dialog', { requestAiBonus: true });

            const state = useBriefDialogStore.getState();
            expect(state.isOpen).toBe(true);
            expect(state.requestAiBonus).toBe(true);
        });
    });
});
