import { toast } from 'sonner';
import { AxiosError } from 'axios';
import { deleteBusiness, getApiMessage } from '@/shared/api';
import { usePendingDeletesStore } from './pendingDeletesStore';

export const UNDO_TIMEOUT_MS = 5000;

interface Args {
    slug: string;
    name: string;
    /**
     * Викликається відразу після scheduling — caller робить optimistic
     * redirect на list (наприклад, `router.replace('/business')`). Cabinet
     * page розмонтовується, але timer/toast живуть у глобальних queues.
     */
    onScheduled: () => void;
    /**
     * Викликається у toast cancel-button (user-initiated undo). Caller
     * повертає користувача на cabinet (наприклад, `router.replace('/business/{slug}')`).
     */
    onCancelled: () => void;
}

/**
 * Sprint 3 §3.8 §C2 + §F8 — frontend-only Undo для delete-flow.
 *
 * **Архітектурна вимога: timer ID у closure, не React ref.** Cabinet page
 * розмонтовується через optimistic redirect (`onScheduled` callback), а React
 * cleanup-effect з clearTimeout вб'є timer до того, як він спрацює. Closure
 * захоплюється sonner toast.action.onClick, який живе у глобальному toast
 * queue (root overlay, не unmount-иться разом з cabinet). `setTimeout` ID
 * зареєстрований у window queue → переживає SPA-navigation.
 *
 * **Optimistic UI removal на list.** `pendingDeletesStore` отримує slug
 * відразу — list page filter-ить його з UI до того, як 5s timer спрацює.
 * Без цього: redirect на list → fresh fetch → бачимо бізнес ще присутнім
 * у списку, що порушує "optimistically прибрати картку" sprint plan §3.8.
 *
 * **Lifecycle pendingDeletesStore:**
 *   - `add(slug)` синхронно перед setTimeout — UI миттєво ховає бізнес.
 *   - User cancel (toast button) → `remove(slug)` + clearTimeout +
 *     `onCancelled` callback (caller redirect-ить назад на cabinet).
 *   - Timer fire **success → slug ЗАЛИШАЄТЬСЯ у pendingDeletes** до
 *     browser-unload. Це критична інваріантна вимога: list page (якщо
 *     mount-нутий під час success) тримає stale `items[]` з останнього
 *     fetch — `setItems` не викликається з scheduleDeleteWithUndo.
 *     Видалення slug-а зі store при success відкрило б filter і повернуло
 *     stale-entry у UI попри те, що backend його вже видалив. Lifecycle:
 *     subsequent navigation/refetch принесе свіжий список БЕЗ видаленого
 *     бізнесу — store-filter природно no-op-итиметься. Memory-cost ~30 B
 *     на slug, очищується разом з window-kill.
 *   - Timer fire failure → `remove(slug)` повертає бізнес у UI +
 *     toast.error з mapped code.
 *
 * **Implicit cancel при browser-unload** (§F8) — window kill автоматично
 * вб'є setTimeout; `pendingDeletesStore` (Zustand in-memory) теж очищується
 * разом з process. Користувач при наступному login побачить бізнес у БД і
 * списку — accepted UX trade-off за sprint plan §F8.
 */
export function scheduleDeleteWithUndo({
    slug,
    name,
    onScheduled,
    onCancelled,
}: Args): void {
    // Optimistic remove з list UI ВІДРАЗУ.
    usePendingDeletesStore.getState().add(slug);

    const timerId = setTimeout(() => {
        void deleteBusiness(slug).catch((err) => {
            // Failure path — повертаємо бізнес у UI; toast з mapped code.
            // Success (no-catch) НЕ remove-ить slug навмисно — див.
            // "Lifecycle pendingDeletesStore" у JSDoc вище. Stale-item у
            // local list state інакше re-show-нувся б через filter unblock.
            usePendingDeletesStore.getState().remove(slug);
            const code =
                err instanceof AxiosError
                    ? ((err.response?.data as
                          | { error?: { code?: string } }
                          | undefined)?.error?.code ?? 'unknown')
                    : 'unknown';
            toast.error(getApiMessage(code, 'businesses'));
        });
    }, UNDO_TIMEOUT_MS);

    const toastId = toast(`«${name}» буде видалено`, {
        duration: UNDO_TIMEOUT_MS,
        action: {
            label: 'Скасувати',
            onClick: () => {
                clearTimeout(timerId);
                usePendingDeletesStore.getState().remove(slug);
                toast.dismiss(toastId);
                toast.message('Видалення скасовано');
                onCancelled();
            },
        },
    });

    onScheduled();
}
