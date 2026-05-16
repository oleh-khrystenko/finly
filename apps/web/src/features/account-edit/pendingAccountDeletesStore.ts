import { create } from 'zustand';

/**
 * Sprint 9 §9.2 — pending-delete tracking для accounts. Композитний ключ
 * `${businessSlug}/${accountSlug}` — account-slug унікальний лише в межах
 * бізнесу (`(businessId, slug)` compound-unique, Sprint 9 §SP-10).
 *
 * Споживачі:
 *  - `scheduleAccountDeleteWithUndo` — add/remove через lifecycle.
 *  - `AccountsSection` (cards-list на business-cabinet-page) — filter
 *    `items.filter(a => !keys.has(makeAccountKey(businessSlug, a.slug)))`,
 *    щоб картка зникла з UI **одразу** після click "Видалити". Без цього
 *    optimistic redirect з account-cabinet → fresh fetch — і ми бачимо
 *    ще-не-видалений рахунок у списку.
 *
 * Той самий patern, що Sprint 4 `pendingInvoiceDeletesStore`, з адаптацією
 * scope-key до Account-domain.
 */
interface PendingAccountDeletesState {
    keys: ReadonlySet<string>;
    add: (businessSlug: string, accountSlug: string) => void;
    remove: (businessSlug: string, accountSlug: string) => void;
    has: (businessSlug: string, accountSlug: string) => boolean;
}

export function makeAccountKey(
    businessSlug: string,
    accountSlug: string
): string {
    return `${businessSlug}/${accountSlug}`;
}

export const usePendingAccountDeletesStore = create<PendingAccountDeletesState>(
    (set, get) => ({
        keys: new Set<string>(),
        add: (businessSlug, accountSlug) =>
            set((s) => {
                const next = new Set(s.keys);
                next.add(makeAccountKey(businessSlug, accountSlug));
                return { keys: next };
            }),
        remove: (businessSlug, accountSlug) =>
            set((s) => {
                const k = makeAccountKey(businessSlug, accountSlug);
                if (!s.keys.has(k)) return s;
                const next = new Set(s.keys);
                next.delete(k);
                return { keys: next };
            }),
        has: (businessSlug, accountSlug) =>
            get().keys.has(makeAccountKey(businessSlug, accountSlug)),
    })
);
