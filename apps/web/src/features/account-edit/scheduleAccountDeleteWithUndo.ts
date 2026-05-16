import { toast } from 'sonner';
import { AxiosError } from 'axios';
import { deleteAccount, getApiMessage } from '@/shared/api';
import { usePendingAccountDeletesStore } from './pendingAccountDeletesStore';

export const ACCOUNT_UNDO_TIMEOUT_MS = 5000;

interface Args {
    businessSlug: string;
    accountSlug: string;
    name: string;
    /**
     * Викликається відразу після scheduling — caller робить optimistic
     * redirect (`router.replace('/business/{slug}')` з account-page).
     * Per-card AccountsSection delete-варіант — без redirect-у (callsite
     * передає no-op-функцію).
     */
    onScheduled: () => void;
    /**
     * User-initiated undo — caller повертає на account-cabinet
     * (`router.replace('/business/{slug}/account/{accountSlug}')`). Для
     * per-card-delete callsite — теж no-op (картка автоматично повертається
     * через `pendingAccountDeletesStore.remove`).
     */
    onCancelled: () => void;
}

/**
 * Sprint 9 §9.2 — той самий 5s frontend-Undo patern, що Sprint 3
 * `scheduleDeleteWithUndo` (business) і Sprint 4 `scheduleInvoiceDeleteWithUndo`,
 * адаптований під account-flow.
 *
 * **Архітектурні аспекти ідентичні** — timer ID у closure (не React ref, бо
 * account-cabinet-page розмонтовується через optimistic redirect), sonner
 * toast queue живе у root layout, browser-unload вб'є setTimeout автоматично.
 *
 * **Optimistic UI removal на list (AccountsSection):**
 * `pendingAccountDeletesStore` отримує `(businessSlug, accountSlug)` відразу —
 * AccountsSection filter-ить відповідний key з UI до того, як 5s timer
 * спрацює. Без цього: redirect на business-cabinet → fresh fetch accounts →
 * бачимо account ще присутнім у списку.
 *
 * **Lifecycle pendingAccountDeletes:**
 *   - `add(...)` синхронно перед setTimeout — UI миттєво ховає account.
 *   - User cancel (toast button) → `remove(...)` + clearTimeout +
 *     `onCancelled` callback.
 *   - Timer fire success → key **ЗАЛИШАЄТЬСЯ** у store до browser-unload (той
 *     самий інваріант, що Sprint 3/4 stores).
 *   - Timer fire failure → `remove(...)` повертає account у UI + toast.error
 *     з mapped code. Особливо важливо для `ACCOUNT_HAS_INVOICES` (409) —
 *     race: за час 5s ФОП встиг створити інвойс через інший таб, backend
 *     reject-не delete. UA-message приходить pre-resolved через
 *     `pluralizeUa`-payload backend-у (`accounts.service.ts:331`); `mapApiCode`
 *     для `ACCOUNT_HAS_INVOICES` свідомо без template, бо message-string
 *     приходить ready-to-display.
 */
export function scheduleAccountDeleteWithUndo({
    businessSlug,
    accountSlug,
    name,
    onScheduled,
    onCancelled,
}: Args): void {
    usePendingAccountDeletesStore
        .getState()
        .add(businessSlug, accountSlug);

    const timerId = setTimeout(() => {
        void deleteAccount(businessSlug, accountSlug).catch((err: unknown) => {
            usePendingAccountDeletesStore
                .getState()
                .remove(businessSlug, accountSlug);
            // ACCOUNT_HAS_INVOICES повертає pre-resolved UA-message у
            // `err.response.data.error.message`. Fallback на mapApiCode для
            // інших codes (network, generic 500).
            const data = err instanceof AxiosError ? err.response?.data : null;
            const errPayload = (
                data as { error?: { code?: string; message?: string } } | null
            )?.error;
            const code = errPayload?.code ?? 'unknown';
            const msg =
                code === 'ACCOUNT_HAS_INVOICES' && errPayload?.message
                    ? errPayload.message
                    : getApiMessage(code, 'accounts');
            toast.error(msg);
        });
    }, ACCOUNT_UNDO_TIMEOUT_MS);

    const toastId = toast(`«${name}» буде видалено`, {
        duration: ACCOUNT_UNDO_TIMEOUT_MS,
        action: {
            label: 'Скасувати',
            onClick: () => {
                clearTimeout(timerId);
                usePendingAccountDeletesStore
                    .getState()
                    .remove(businessSlug, accountSlug);
                toast.dismiss(toastId);
                toast.message('Видалення скасовано');
                onCancelled();
            },
        },
    });

    onScheduled();
}
