/**
 * Sprint 4 §4.6 + Sprint 9 §SP-10 — критичний регресійний тест на frontend
 * Undo для інвойсу.
 *
 * **Sprint 9 update**: 3-арг key `(business, account, invoice)`; інвойсна
 * uniqueness scope-нута на `(accountId, slug)`, тому два account-и одного
 * business-у можуть мати інвойс з тим самим slug-string-ом — composite-key
 * обов'язковий для коректного filter-у у `InvoicesSection`.
 *
 * Контракт:
 *  - 5s pass → DELETE called.
 *  - cancel у межах 5s → DELETE НЕ called.
 *  - pendingInvoiceDeletesStore add синхронно перед setTimeout.
 *  - success → key ЗАЛИШАЄТЬСЯ у store до browser-unload.
 *  - failure → key remove (UI restore-ить інвойс).
 *  - Privat-inv-001 і Mono-inv-001 у одному business-i — НЕ колидують
 *    (3-сегментний key disambiguator).
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
const ACC = 'aB3xQ9k7';
const INV = 'order-2026-aB3xQ9k7';
const KEY = makeInvoiceKey(BIZ, ACC, INV);

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
            accountSlug: ACC,
            invoiceSlug: INV,
            onScheduled,
            onCancelled: jest.fn(),
        });
        expect(onScheduled).toHaveBeenCalledTimes(1);
    });

    it('показує sonner toast з cancel-button', () => {
        scheduleInvoiceDeleteWithUndo({
            businessSlug: BIZ,
            accountSlug: ACC,
            invoiceSlug: INV,
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });
        expect(mockToast).toHaveBeenCalledWith(
            `Інвойс «${INV}» буде видалено`,
            expect.objectContaining({
                duration: INVOICE_UNDO_TIMEOUT_MS,
                action: expect.objectContaining({ label: 'Скасувати' }),
            })
        );
    });

    it('після 5s викликає deleteInvoice(business, account, invoice)', () => {
        mockDeleteInvoice.mockResolvedValue(undefined);
        scheduleInvoiceDeleteWithUndo({
            businessSlug: BIZ,
            accountSlug: ACC,
            invoiceSlug: INV,
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });

        expect(mockDeleteInvoice).not.toHaveBeenCalled();
        jest.advanceTimersByTime(INVOICE_UNDO_TIMEOUT_MS);
        expect(mockDeleteInvoice).toHaveBeenCalledWith(BIZ, ACC, INV);
        expect(mockDeleteInvoice).toHaveBeenCalledTimes(1);
    });

    it('cancel у межах 5s — deleteInvoice НЕ викликається + onCancelled виконується', () => {
        const onCancelled = jest.fn();
        scheduleInvoiceDeleteWithUndo({
            businessSlug: BIZ,
            accountSlug: ACC,
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

    it('add(...) у pendingDeletes ВІДРАЗУ при scheduling (synchronous)', () => {
        scheduleInvoiceDeleteWithUndo({
            businessSlug: BIZ,
            accountSlug: ACC,
            invoiceSlug: INV,
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });
        expect(usePendingInvoiceDeletesStore.getState().keys.has(KEY)).toBe(
            true
        );
    });

    it('cancel button → remove(...) з pendingDeletes', () => {
        scheduleInvoiceDeleteWithUndo({
            businessSlug: BIZ,
            accountSlug: ACC,
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

    it('success after 5s → key ЗАЛИШАЄТЬСЯ у pendingDeletes', async () => {
        mockDeleteInvoice.mockResolvedValue(undefined);
        scheduleInvoiceDeleteWithUndo({
            businessSlug: BIZ,
            accountSlug: ACC,
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
        expect(mockDeleteInvoice).toHaveBeenCalledWith(BIZ, ACC, INV);
    });

    it('failure after 5s → remove(...)', async () => {
        const apiError = Object.assign(new Error('failed'), {
            response: { data: { error: { code: 'INTERNAL_ERROR' } } },
        });
        mockDeleteInvoice.mockRejectedValue(apiError);
        scheduleInvoiceDeleteWithUndo({
            businessSlug: BIZ,
            accountSlug: ACC,
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

    it('Sprint 9 §SP-10 regression — Privat-inv-001 і Mono-inv-001 у одному бізнесі НЕ колидують', () => {
        // add(biz, accPrivat, 'inv-001') — Privat-namespace.
        scheduleInvoiceDeleteWithUndo({
            businessSlug: BIZ,
            accountSlug: 'privatAA',
            invoiceSlug: 'inv-001',
            onScheduled: jest.fn(),
            onCancelled: jest.fn(),
        });

        const store = usePendingInvoiceDeletesStore.getState();
        // Privat-key є.
        expect(store.has(BIZ, 'privatAA', 'inv-001')).toBe(true);
        // Mono-key з тим самим invoice-slug-string — НЕ присутній (інший
        // composite key).
        expect(store.has(BIZ, 'monoBBBB', 'inv-001')).toBe(false);
    });
});
