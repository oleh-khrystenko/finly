import { create } from 'zustand';

/**
 * Sprint 3 §3.8 §C2 — pending-delete tracking. Slug додається у set перед
 * 5s-таймером; cancel/error → видаляється; success → лишається (бо БД-стан
 * відповідає).
 *
 * Споживачі:
 *   - `scheduleDeleteWithUndo` — add/remove через lifecycle.
 *   - `/business/page.tsx` (list) — filter `items.filter(i => !slugs.has(i.slug))`,
 *     щоб бізнес зник з UI **одразу** після click "Видалити", незалежно від
 *     того, чи запущений 5s timer чи вже спрацював. Без цього: optimistic
 *     redirect з cabinet → list re-fetch → бачимо ще-не-видалений бізнес у
 *     списку, що порушує "optimistically прибрати картку з UI" sprint plan §3.8.
 *
 * Store глобальний (in-slice) — shared між cabinet (writer) і list (reader).
 */
interface PendingDeletesState {
    slugs: ReadonlySet<string>;
    add: (slug: string) => void;
    remove: (slug: string) => void;
}

export const usePendingDeletesStore = create<PendingDeletesState>((set) => ({
    slugs: new Set<string>(),
    add: (slug) =>
        set((s) => {
            const next = new Set(s.slugs);
            next.add(slug);
            return { slugs: next };
        }),
    remove: (slug) =>
        set((s) => {
            if (!s.slugs.has(slug)) return s;
            const next = new Set(s.slugs);
            next.delete(slug);
            return { slugs: next };
        }),
}));
