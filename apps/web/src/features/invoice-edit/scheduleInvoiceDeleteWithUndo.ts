import { toast } from 'sonner';
import { AxiosError } from 'axios';
import { deleteInvoice, getApiMessage } from '@/shared/api';
import { usePendingInvoiceDeletesStore } from './pendingInvoiceDeletesStore';

export const INVOICE_UNDO_TIMEOUT_MS = 5000;

interface Args {
    businessSlug: string;
    invoiceSlug: string;
    /**
     * Викликається відразу після scheduling — caller робить optimistic
     * redirect (наприклад, `router.replace('/business/{slug}#invoices')`).
     */
    onScheduled: () => void;
    /**
     * User-initiated undo — caller повертає на cabinet інвойсу
     * (`router.replace('/business/{slug}/invoice/{invoiceSlug}')`).
     */
    onCancelled: () => void;
}

/**
 * Sprint 4 §4.6 — той самий 5s frontend-Undo patern, що Sprint 3
 * `scheduleDeleteWithUndo`, адаптований під invoice-flow.
 *
 * **Архітектурні аспекти ідентичні Sprint 3** — timer ID у closure (не
 * React ref, бо cabinet-page розмонтовується через optimistic redirect),
 * sonner toast queue живе у root layout, browser-unload вб'є setTimeout
 * автоматично.
 *
 * **Optimistic UI removal на list.** `pendingInvoiceDeletesStore` отримує
 * `(businessSlug, invoiceSlug)` відразу — `InvoicesSection` filter-ить
 * відповідний key з UI до того, як 5s timer спрацює. Без цього: redirect
 * на бізнес-сторінку → fresh fetch invoices → бачимо інвойс ще присутнім
 * у списку, попри що user натиснув "Видалити".
 *
 * **Lifecycle pendingInvoiceDeletes:**
 *   - `add(...)` синхронно перед setTimeout — UI миттєво ховає інвойс.
 *   - User cancel (toast button) → `remove(...)` + clearTimeout +
 *     `onCancelled` callback (caller redirect-ить назад на cabinet).
 *   - Timer fire success → key **ЗАЛИШАЄТЬСЯ** у store до browser-unload
 *     (той самий інваріант, що Sprint 3): list може тримати stale items[]
 *     із попереднього fetch — видалення key зі store відкрило б filter і
 *     повернуло stale-entry у UI попри те, що backend його видалив.
 *     Subsequent navigation/refetch принесе свіжий список без інвойсу —
 *     filter природно стане no-op.
 *   - Timer fire failure → `remove(...)` повертає інвойс у UI + toast.error
 *     з mapped code.
 */
export function scheduleInvoiceDeleteWithUndo({
    businessSlug,
    invoiceSlug,
    onScheduled,
    onCancelled,
}: Args): void {
    // Optimistic remove з list UI ВІДРАЗУ.
    usePendingInvoiceDeletesStore.getState().add(businessSlug, invoiceSlug);

    const timerId = setTimeout(() => {
        void deleteInvoice(businessSlug, invoiceSlug).catch((err: unknown) => {
            // Failure path — повертаємо інвойс у UI; toast з mapped code.
            // Success (no-catch) НЕ remove-ить key навмисно — див.
            // "Lifecycle" у JSDoc вище.
            usePendingInvoiceDeletesStore
                .getState()
                .remove(businessSlug, invoiceSlug);
            const code =
                err instanceof AxiosError
                    ? ((
                          err.response?.data as
                              | { error?: { code?: string } }
                              | undefined
                      )?.error?.code ?? 'unknown')
                    : 'unknown';
            toast.error(getApiMessage(code, 'invoices'));
        });
    }, INVOICE_UNDO_TIMEOUT_MS);

    const toastId = toast(`Рахунок «${invoiceSlug}» буде видалено`, {
        duration: INVOICE_UNDO_TIMEOUT_MS,
        action: {
            label: 'Скасувати',
            onClick: () => {
                clearTimeout(timerId);
                usePendingInvoiceDeletesStore
                    .getState()
                    .remove(businessSlug, invoiceSlug);
                toast.dismiss(toastId);
                toast.message('Видалення скасовано');
                onCancelled();
            },
        },
    });

    onScheduled();
}
