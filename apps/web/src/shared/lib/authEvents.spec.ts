import { authEvents } from './authEvents';

describe('authEvents', () => {
    // The bus is a module-level singleton; each test must clean up its
    // own subscriptions to avoid cross-test bleed.
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        while (cleanups.length) {
            cleanups.pop()?.();
        }
    });

    const subscribe = (event: 'session-lost', listener: () => void): void => {
        cleanups.push(authEvents.on(event, listener));
    };

    it('delivers an event to a single subscriber', () => {
        const listener = jest.fn();
        subscribe('session-lost', listener);

        authEvents.emit('session-lost');

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('delivers an event to multiple subscribers in subscription order', () => {
        const calls: number[] = [];
        subscribe('session-lost', () => calls.push(1));
        subscribe('session-lost', () => calls.push(2));
        subscribe('session-lost', () => calls.push(3));

        authEvents.emit('session-lost');

        expect(calls).toEqual([1, 2, 3]);
    });

    it('does nothing when no subscribers are registered', () => {
        expect(() => authEvents.emit('session-lost')).not.toThrow();
    });

    it('unsubscribe removes the listener', () => {
        const listener = jest.fn();
        const unsubscribe = authEvents.on('session-lost', listener);

        unsubscribe();
        authEvents.emit('session-lost');

        expect(listener).not.toHaveBeenCalled();
    });

    it('unsubscribe is idempotent', () => {
        const listener = jest.fn();
        const unsubscribe = authEvents.on('session-lost', listener);

        unsubscribe();
        unsubscribe();
        authEvents.emit('session-lost');

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

        subscribe('session-lost', failing);
        subscribe('session-lost', succeeding);

        expect(() => authEvents.emit('session-lost')).not.toThrow();
        expect(failing).toHaveBeenCalledTimes(1);
        expect(succeeding).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalled();

        errorSpy.mockRestore();
    });

    it('allows a listener to unsubscribe itself during delivery', () => {
        const second = jest.fn();
        const first = jest.fn(() => {
            unsubscribeFirst();
        });
        const unsubscribeFirst = authEvents.on('session-lost', first);
        cleanups.push(unsubscribeFirst);
        subscribe('session-lost', second);

        authEvents.emit('session-lost');

        // Both listeners run on first emit because we iterate a snapshot.
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);

        // After self-unsubscribe, only `second` remains.
        authEvents.emit('session-lost');
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(2);
    });
});
