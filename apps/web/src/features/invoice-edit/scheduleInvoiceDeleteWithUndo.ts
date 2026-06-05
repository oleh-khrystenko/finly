import { toast } from 'sonner';
import { AxiosError } from 'axios';
import { deleteInvoice, getApiMessage } from '@/shared/api';
import { usePendingInvoiceDeletesStore } from './pendingInvoiceDeletesStore';

export const INVOICE_UNDO_TIMEOUT_MS = 5000;

interface Args {
    businessSlug: string;
    accountSlug: string;
    invoiceSlug: string;
    /**
     * Викликається відразу після scheduling — caller робить optimistic
     * redirect (наприклад, `router.replace('/business/{slug}/account/{accountSlug}')`).
     */
    onScheduled: () => void;
    /**
     * User-initiated undo — caller повертає на cabinet інвойсу.
     */
    onCancelled: () => void;
}

/**
 * Sprint 4 §4.6 + Sprint 9 §SP-10 — 5s frontend-Undo patern для invoice-delete.
 *
 * **Sprint 9 signature update**: 3-арг `(businessSlug, accountSlug, invoiceSlug)`
 * замість 2-арг. URL `/businesses/me/{biz}/accounts/{acc}/invoices/{inv}` —
 * `accountSlug` обовʼязковий для DELETE.
 *
 * **Архітектурні аспекти ідентичні Sprint 3/4**: timer ID у closure (не React
 * ref), sonner toast queue у root layout, browser-unload вб'є setTimeout.
 *
 * **Lifecycle pendingInvoiceDeletes:** add синхронно перед setTimeout; success
 * → key лишається у store до browser-unload (захист від stale-item re-show);
 * failure → remove + toast.error з mapped code.
 */
export function scheduleInvoiceDeleteWithUndo({
    businessSlug,
    accountSlug,
    invoiceSlug,
    onScheduled,
    onCancelled,
}: Args): void {
    usePendingInvoiceDeletesStore
        .getState()
        .add(businessSlug, accountSlug, invoiceSlug);

    const timerId = setTimeout(() => {
        void deleteInvoice(businessSlug, accountSlug, invoiceSlug).catch(
            (err: unknown) => {
                usePendingInvoiceDeletesStore
                    .getState()
                    .remove(businessSlug, accountSlug, invoiceSlug);
                const code =
                    err instanceof AxiosError
                        ? ((
                              err.response?.data as
                                  | { error?: { code?: string } }
                                  | undefined
                          )?.error?.code ?? 'unknown')
                        : 'unknown';
                toast.error(getApiMessage(code, 'invoices'));
            }
        );
    }, INVOICE_UNDO_TIMEOUT_MS);

    const toastId = toast(`Рахунок «${invoiceSlug}» буде видалено`, {
        duration: INVOICE_UNDO_TIMEOUT_MS,
        action: {
            label: 'Скасувати',
            onClick: () => {
                clearTimeout(timerId);
                usePendingInvoiceDeletesStore
                    .getState()
                    .remove(businessSlug, accountSlug, invoiceSlug);
                toast.dismiss(toastId);
                toast.message('Видалення скасовано');
                onCancelled();
            },
        },
    });

    onScheduled();
}
