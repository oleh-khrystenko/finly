import { create } from 'zustand';

/**
 * Sprint 4 §4.6 — pending-delete tracking для інвойсів. Той самий patern, що
 * Sprint 3 `business-edit/pendingDeletesStore`, з композитним ключем
 * `${businessSlug}/${invoiceSlug}` — invoice-slug унікальний лише в межах
 * бізнесу.
 *
 * Споживачі:
 *   - `scheduleInvoiceDeleteWithUndo` — add/remove через lifecycle.
 *   - `InvoicesSection` (list) — filter `items.filter(i => !keys.has(...))`
 *     щоб інвойс зник з UI **одразу** після click "Видалити". Без цього:
 *     optimistic redirect з invoice-cabinet → list re-fetch → бачимо
 *     ще-не-видалений рахунок до того, як 5s timer спрацює.
 */
interface PendingInvoiceDeletesState {
    keys: ReadonlySet<string>;
    add: (businessSlug: string, invoiceSlug: string) => void;
    remove: (businessSlug: string, invoiceSlug: string) => void;
    has: (businessSlug: string, invoiceSlug: string) => boolean;
}

export function makeInvoiceKey(
    businessSlug: string,
    invoiceSlug: string,
): string {
    return `${businessSlug}/${invoiceSlug}`;
}

export const usePendingInvoiceDeletesStore = create<PendingInvoiceDeletesState>(
    (set, get) => ({
        keys: new Set<string>(),
        add: (businessSlug, invoiceSlug) =>
            set((s) => {
                const next = new Set(s.keys);
                next.add(makeInvoiceKey(businessSlug, invoiceSlug));
                return { keys: next };
            }),
        remove: (businessSlug, invoiceSlug) =>
            set((s) => {
                const k = makeInvoiceKey(businessSlug, invoiceSlug);
                if (!s.keys.has(k)) return s;
                const next = new Set(s.keys);
                next.delete(k);
                return { keys: next };
            }),
        has: (businessSlug, invoiceSlug) =>
            get().keys.has(makeInvoiceKey(businessSlug, invoiceSlug)),
    }),
);
