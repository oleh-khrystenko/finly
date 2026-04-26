import { uiIntents } from './uiIntents';

describe('uiIntents', () => {
    // The bus is a module-level singleton; tests must clean up their own
    // subscriptions to avoid cross-test bleed.
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        while (cleanups.length) {
            cleanups.pop()?.();
        }
    });

    it('delivers an intent payload to a subscribed listener', () => {
        const listener = jest.fn();
        cleanups.push(uiIntents.on('open-brief-dialog', listener));

        uiIntents.emit('open-brief-dialog', { requestAiBonus: true });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith({ requestAiBonus: true });
    });

    it('delivers payloads to multiple listeners in subscription order', () => {
        const calls: number[] = [];
        cleanups.push(uiIntents.on('open-brief-dialog', () => calls.push(1)));
        cleanups.push(uiIntents.on('open-brief-dialog', () => calls.push(2)));
        cleanups.push(uiIntents.on('open-brief-dialog', () => calls.push(3)));

        uiIntents.emit('open-brief-dialog', {});

        expect(calls).toEqual([1, 2, 3]);
    });

    it('silently drops intents when no listener is registered', () => {
        // No listener; should not throw.
        expect(() =>
            uiIntents.emit('open-brief-dialog', { requestAiBonus: false })
        ).not.toThrow();
    });

    it('unsubscribe removes the listener', () => {
        const listener = jest.fn();
        const unsubscribe = uiIntents.on('open-brief-dialog', listener);

        unsubscribe();
        uiIntents.emit('open-brief-dialog', { requestAiBonus: true });

        expect(listener).not.toHaveBeenCalled();
    });

    it('isolates listener failures so subsequent listeners still run', () => {
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        const failing = jest.fn(() => {
            throw new Error('boom');
        });
        const succeeding = jest.fn();

        cleanups.push(uiIntents.on('open-brief-dialog', failing));
        cleanups.push(uiIntents.on('open-brief-dialog', succeeding));

        expect(() =>
            uiIntents.emit('open-brief-dialog', {})
        ).not.toThrow();
        expect(failing).toHaveBeenCalledTimes(1);
        expect(succeeding).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalled();

        errorSpy.mockRestore();
    });
});
