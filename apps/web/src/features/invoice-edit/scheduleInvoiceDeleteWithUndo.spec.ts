/**
 * Sprint 4 §4.6 — критичний регресійний тест на frontend Undo для інвойсу.
 *
 * Той самий контракт, що Sprint 3 `scheduleDeleteWithUndo.spec.ts`:
 *  - 5s pass → DELETE called.
 *  - cancel у межах 5s → DELETE НЕ called.
 *  - pendingInvoiceDeletesStore add синхронно перед setTimeout (optimistic
 *    UI removal у `InvoicesSection`).
 *  - success → key ЗАЛИШАЄТЬСЯ у store до browser-unload (захист від
 *    re-show stale-entry у локальному state).
 *  - failure → key remove (UI restore-ить інвойс).
 */

const mockDeleteInvoice = jest.fn();
const mockToast = jest.fn();
const mockToastDismiss = jest.fn();
const mockToastMessage = jest.fn();
const mockToastError = jest.fn();
type ToastAction = { label: string; onClick: () => void };
let lastToastAction: ToastAction | null = null;

jest.mock('@/shared/api', () => ({
    deleteInvoice: (...args: unknown[]) => mockDeleteInvoice(...args),
    getApiMessage: (code: string) => `mapped:${code}`,
}));

jest.mock('sonner', () => ({
    toast: Object.assign(
        (label: string, opts: { action?: ToastAction }) => {
            lastToastAction = opts.action ?? null;
            mockToast(label, opts);
            return 'toast-id';
        },
        {
            dismiss: (...args: unknown[]) => mockToastDismiss(...args),
            message: (...args: unknown[]) => mockToastMessage(...args),
            error: (...args: unknown[]) => mockToastError(...args),
        }
    ),
}));

import {
    scheduleInvoiceDeleteWithUndo,
    INVOICE_UNDO_TIMEOUT_MS,
} from './scheduleInvoiceDeleteWithUndo';
import {
    usePendingInvoiceDeletesStore,
    makeInvoiceKey,
} from './pendingInvoiceDeletesStore';

const BIZ = 'IvanEnko';
const INV = 'order-2026-aB3xQ9k7';
const KEY = makeInvoiceKey(BIZ, INV);

describe('scheduleInvoiceDeleteWithUndo', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        lastToastAction = null;
        usePendingInvoiceDeletesStore.setState({ keys: new Set<string>() });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('викликає onScheduled синхронно (для optimistic redirect)', () => {
        const onScheduled = jest.fn();
        scheduleInvoiceDeleteWithUndo({
            businessSlug: BIZ,
            invoiceSlug: INV,
            onScheduled,
            onCancelled: jest.fn(),
        });
        expect(onScheduled).toHaveBeenCalledTimes(1);
    });

    it('показує sonner toast з cancel-button', () => {
        scheduleInvoiceDeleteWithUndo({
            businessSlug: BIZ,
            invoiceSlug: INV,
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });
        expect(mockToast).toHaveBeenCalledWith(
            `Рахунок «${INV}» буде видалено`,
            expect.objectContaining({
                duration: INVOICE_UNDO_TIMEOUT_MS,
                action: expect.objectContaining({ label: 'Скасувати' }),
            })
        );
    });

    it('після 5s викликає deleteInvoice(business, invoice) — критичний path', () => {
        mockDeleteInvoice.mockResolvedValue(undefined);
        scheduleInvoiceDeleteWithUndo({
            businessSlug: BIZ,
            invoiceSlug: INV,
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });

        expect(mockDeleteInvoice).not.toHaveBeenCalled();
        jest.advanceTimersByTime(INVOICE_UNDO_TIMEOUT_MS);
        expect(mockDeleteInvoice).toHaveBeenCalledWith(BIZ, INV);
        expect(mockDeleteInvoice).toHaveBeenCalledTimes(1);
    });

    it('cancel у межах 5s — deleteInvoice НЕ викликається + onCancelled виконується', () => {
        const onCancelled = jest.fn();
        scheduleInvoiceDeleteWithUndo({
            businessSlug: BIZ,
            invoiceSlug: INV,
            onScheduled: jest.fn(),
            onCancelled,
        });

        jest.advanceTimersByTime(2000);

        expect(lastToastAction).not.toBeNull();
        lastToastAction!.onClick();

        jest.advanceTimersByTime(INVOICE_UNDO_TIMEOUT_MS);
        expect(mockDeleteInvoice).not.toHaveBeenCalled();
        expect(onCancelled).toHaveBeenCalledTimes(1);

        expect(mockToastDismiss).toHaveBeenCalledWith('toast-id');
        expect(mockToastMessage).toHaveBeenCalledWith('Видалення скасовано');
    });

    it('cancel у межах 5s — clearTimeout працює навіть якщо ref-ів немає', () => {
        scheduleInvoiceDeleteWithUndo({
            businessSlug: BIZ,
            invoiceSlug: INV,
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });
        lastToastAction!.onClick();
        jest.advanceTimersByTime(INVOICE_UNDO_TIMEOUT_MS * 2);
        expect(mockDeleteInvoice).not.toHaveBeenCalled();
    });

    it('add(...) у pendingDeletes ВІДРАЗУ при scheduling (synchronous)', () => {
        scheduleInvoiceDeleteWithUndo({
            businessSlug: BIZ,
            invoiceSlug: INV,
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });
        expect(usePendingInvoiceDeletesStore.getState().keys.has(KEY)).toBe(
            true
        );
    });

    it('cancel button → remove(...) з pendingDeletes (інвойс повертається у list)', () => {
        scheduleInvoiceDeleteWithUndo({
            businessSlug: BIZ,
            invoiceSlug: INV,
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });
        expect(usePendingInvoiceDeletesStore.getState().keys.has(KEY)).toBe(
            true
        );
        lastToastAction!.onClick();
        expect(usePendingInvoiceDeletesStore.getState().keys.has(KEY)).toBe(
            false
        );
    });

    it('success after 5s → key ЗАЛИШАЄТЬСЯ у pendingDeletes (інваріант проти UI re-show)', async () => {
        mockDeleteInvoice.mockResolvedValue(undefined);
        scheduleInvoiceDeleteWithUndo({
            businessSlug: BIZ,
            invoiceSlug: INV,
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });
        jest.advanceTimersByTime(INVOICE_UNDO_TIMEOUT_MS);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(usePendingInvoiceDeletesStore.getState().keys.has(KEY)).toBe(
            true
        );
        expect(mockDeleteInvoice).toHaveBeenCalledWith(BIZ, INV);
    });

    it('failure after 5s → remove(...) — UI restore-ить інвойс у list', async () => {
        const apiError = Object.assign(new Error('failed'), {
            response: { data: { error: { code: 'INTERNAL_ERROR' } } },
        });
        mockDeleteInvoice.mockRejectedValue(apiError);
        scheduleInvoiceDeleteWithUndo({
            businessSlug: BIZ,
            invoiceSlug: INV,
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });
        jest.advanceTimersByTime(INVOICE_UNDO_TIMEOUT_MS);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(usePendingInvoiceDeletesStore.getState().keys.has(KEY)).toBe(
            false
        );
    });
});
