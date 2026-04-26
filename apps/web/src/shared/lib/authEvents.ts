/**
 * Auth lifecycle event bus.
 *
 * Decouples `shared/api` (HTTP layer) from higher FSD layers (`entities`,
 * `features`). The HTTP client publishes auth lifecycle events; domain
 * stores subscribe and own the corresponding state transitions.
 *
 * This inverts the dependency: `shared/api` no longer needs to know that
 * an auth store exists, eliminating the circular import that previously
 * required a dynamic `import()` workaround inside the axios response
 * interceptor.
 *
 * Events:
 *   - `session-lost` — emitted when the HTTP client determines the user's
 *     session is irrecoverably lost (refresh failed, no fallback).
 *     Subscribers should clear any in-memory user state.
 */

export type AuthEvent = 'session-lost';

type Listener = () => void;

class AuthEventBus {
    private readonly listeners = new Map<AuthEvent, Set<Listener>>();

    /**
     * Subscribe to an auth event. Returns an unsubscribe function.
     *
     * Listeners are invoked synchronously in subscription order. A
     * listener that throws does not prevent subsequent listeners from
     * running — failures are isolated to the offending subscriber.
     */
    on(event: AuthEvent, listener: Listener): () => void {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(listener);

        return () => {
            set.delete(listener);
        };
    }

    /**
     * Publish an auth event. Iterates over a snapshot of the listener
     * set so subscribers may safely unsubscribe themselves during
     * delivery.
     */
    emit(event: AuthEvent): void {
        const set = this.listeners.get(event);
        if (!set || set.size === 0) return;

        for (const listener of [...set]) {
            try {
                listener();
            } catch (err) {
                // Listener failures must not break the publish loop.
                // Logged so they remain visible during development.
                console.error(
                    `[authEvents] listener for "${event}" threw:`,
                    err
                );
            }
        }
    }
}

export const authEvents = new AuthEventBus();
