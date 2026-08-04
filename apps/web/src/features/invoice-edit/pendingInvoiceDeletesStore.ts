import { create } from 'zustand';

/**
 * Sprint 4 §4.6 + Sprint 9 §SP-10 — pending-delete tracking для інвойсів.
 *
 * **Sprint 9 rekey: 3-сегментний composite key `${businessSlug}/${accountSlug}/
 * ${invoiceSlug}`.** До Sprint 9 ключем був 2-сегментний (`business/invoice`),
 * бо invoice-slug-uniqueness scope був `(businessId, slug)`. Sprint 9 §SP-6
 * перевів uniqueness на `(accountId, slug)` — два account-и одного business-у
 * **дозволено** мати інвойс з однаковим slug-string-ом (per-account counter-
 * namespace; Privat-`inv-001` і Mono-`inv-001`). 2-сегментний key колидувпав
 * би: `add('biz', 'inv-001')` ховав би обидва інвойси з UI.
 *
 * Composite-key contract — той самий patern, що Sprint 9 §SP-10 фіксує для
 * `pendingAccountDeletesStore` (business/account compound-uniqueness): key
 * мусить дорівнювати uniqueness-scope-у БД.
 *
 * Споживачі:
 *   - `scheduleInvoiceDeleteWithUndo` — add/remove через lifecycle.
 *   - `InvoicesSection` (list) — filter `items.filter(i => !keys.has(...))`.
 */
interface PendingInvoiceDeletesState {
    keys: ReadonlySet<string>;
    add: (
        businessSlug: string,
        accountSlug: string,
        invoiceSlug: string
    ) => void;
    remove: (
        businessSlug: string,
        accountSlug: string,
        invoiceSlug: string
    ) => void;
    has: (
        businessSlug: string,
        accountSlug: string,
        invoiceSlug: string
    ) => boolean;
}

export function makeInvoiceKey(
    businessSlug: string,
    accountSlug: string,
    invoiceSlug: string
): string {
    return `${businessSlug}/${accountSlug}/${invoiceSlug}`;
}

export const usePendingInvoiceDeletesStore = create<PendingInvoiceDeletesState>(
    (set, get) => ({
        keys: new Set<string>(),
        add: (businessSlug, accountSlug, invoiceSlug) =>
            set((s) => {
                const next = new Set(s.keys);
                next.add(
                    makeInvoiceKey(businessSlug, accountSlug, invoiceSlug)
                );
                return { keys: next };
            }),
        remove: (businessSlug, accountSlug, invoiceSlug) =>
            set((s) => {
                const k = makeInvoiceKey(
                    businessSlug,
                    accountSlug,
                    invoiceSlug
                );
                if (!s.keys.has(k)) return s;
                const next = new Set(s.keys);
                next.delete(k);
                return { keys: next };
            }),
        has: (businessSlug, accountSlug, invoiceSlug) =>
            get().keys.has(
                makeInvoiceKey(businessSlug, accountSlug, invoiceSlug)
            ),
    })
);
