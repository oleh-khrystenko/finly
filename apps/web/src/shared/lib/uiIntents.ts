/**
 * UI intents bus — cross-slice imperative UI commands with typed payloads.
 *
 * Used to invert dependencies when a slice in one module needs to trigger
 * a UI action owned by a different slice (typically across the core/agency
 * boundary, or across feature boundaries) without importing it directly.
 *
 * Publishers fire intents from anywhere; subscribers register from their
 * owning slice. This keeps lower/peer slices ignorant of higher/sibling
 * slices' implementations while still allowing imperative cross-slice
 * coordination — the same inversion pattern that `authEvents` uses for
 * lifecycle notifications, generalized to carry payloads.
 *
 * Example: an `app/` page in core needs to open the agency-owned brief
 * dialog. The page emits `open-brief-dialog` here; the agency feature's
 * brief dialog store subscribes from `features/agency/brief/`. Neither
 * side imports the other.
 */

export type UiIntent = {
    /**
     * Open the brief dialog (owned by `features/agency/brief/`). The
     * payload mirrors the dialog store's `open()` argument.
     *
     * Payload:
     *   - `requestAiBonus`: when true, the dialog opens in the AI bonus
     *     grant flow (server marks the brief as eligible for bonus).
     */
    'open-brief-dialog': { requestAiBonus?: boolean };
};

type IntentName = keyof UiIntent;
type Listener<N extends IntentName> = (payload: UiIntent[N]) => void;

class UiIntentBus {
    private readonly listeners = new Map<IntentName, Set<Listener<IntentName>>>();

    /**
     * Subscribe to a UI intent. Returns an unsubscribe function. Multiple
     * listeners per intent are supported, though most intents have a
     * single owning listener registered at module init.
     */
    on<N extends IntentName>(name: N, listener: Listener<N>): () => void {
        let set = this.listeners.get(name);
        if (!set) {
            set = new Set();
            this.listeners.set(name, set);
        }
        // Cast: per-key listeners are homogeneous, but the Set is keyed
        // by the union to keep the field type expressible.
        set.add(listener as Listener<IntentName>);

        return () => {
            set.delete(listener as Listener<IntentName>);
        };
    }

    /**
     * Publish a UI intent. Iterates over a snapshot so listeners may
     * safely unsubscribe themselves during delivery. Failures of one
     * listener do not prevent subsequent listeners from running.
     *
     * If no listener is registered the intent is silently dropped — by
     * design, since the intent is fire-and-forget. Critical workflows
     * must ensure the owning slice is loaded before emission (typically
     * via the global overlay registry in `app/overlays.tsx`, which
     * mounts overlay components on every page).
     */
    emit<N extends IntentName>(name: N, payload: UiIntent[N]): void {
        const set = this.listeners.get(name);
        if (!set || set.size === 0) return;

        for (const listener of [...set]) {
            try {
                (listener as Listener<N>)(payload);
            } catch (err) {
                console.error(
                    `[uiIntents] listener for "${name}" threw:`,
                    err
                );
            }
        }
    }
}

export const uiIntents = new UiIntentBus();
