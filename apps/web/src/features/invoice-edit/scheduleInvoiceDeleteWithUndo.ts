import { toast } from 'sonner';
import { AxiosError } from 'axios';
import { deleteInvoice, getApiMessage } from '@/shared/api';

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
 * `scheduleDeleteWithUndo` (для бізнесу), адаптований під invoice-flow.
 *
 * **Архітектурні аспекти ідентичні Sprint 3** — timer ID у closure (не
 * React ref, бо cabinet-page розмонтовується через optimistic redirect),
 * sonner toast queue живе у root layout, browser-unload вб'є setTimeout
 * автоматично.
 *
 * **Без pendingDeletesStore** на відміну від Sprint 3 business-delete —
 * invoice-list (`InvoicesSection`) рідко монтується одночасно з invoice-
 * cabinet-сторінкою (різні routes). Якщо ФОП повернеться на список одразу
 * після schedule і timer ще не спрацював — fresh fetch з backend поверне
 * invoice (бо delete ще не виконаний). Acceptable race-window 5 секунд;
 * Sprint 6 додасть pendingInvoicesStore якщо feedback виявить biг.
 */
export function scheduleInvoiceDeleteWithUndo({
    businessSlug,
    invoiceSlug,
    onScheduled,
    onCancelled,
}: Args): void {
    const timerId = setTimeout(() => {
        void deleteInvoice(businessSlug, invoiceSlug).catch((err: unknown) => {
            const code =
                err instanceof AxiosError
                    ? ((err.response?.data as
                          | { error?: { code?: string } }
                          | undefined)?.error?.code ?? 'unknown')
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
                toast.dismiss(toastId);
                toast.message('Видалення скасовано');
                onCancelled();
            },
        },
    });

    onScheduled();
}
