'use client';

import { useEffect, useRef } from 'react';

import { getMe } from '@/shared/api';
import { useAuthStore } from './authStore';
import { useCanEditSlug } from './useAccessLevel';

/**
 * Sprint 20 — добивання наміру після оплати. Коли користувач уже платний
 * (brand+) і має активну бронь на цю сутність, бажане ім'я застосовується
 * звичайним rename-ом (`apply`, що під капотом робить PATCH + навігацію на новий
 * slug). Спрацьовує і на поверненні з білінгу (returnPath веде на цю сторінку),
 * і при наступному заході в кабінет, якщо повернення не сталось.
 *
 * Фолбек: ім'я перехопили поки користувач платив → rename кидає `SLUG_TAKEN`,
 * `onTaken` відкриває поле редагування (підписка вже діє, людина обирає інше).
 *
 * Guard через ref — один прохід на mount; після успіху бронь зникає з профілю
 * (rename споживає її на бекенді, `getMe` оновлює стор).
 */
export function useApplyPendingSlug(opts: {
    matches: boolean;
    desiredSlug: string | null;
    apply: (slug: string) => Promise<void>;
    onTaken: () => void;
}): void {
    const { matches, desiredSlug, apply, onTaken } = opts;
    const isPaid = useCanEditSlug();
    const doneRef = useRef(false);

    useEffect(() => {
        if (doneRef.current) return;
        if (!isPaid || !matches || !desiredSlug) return;
        doneRef.current = true;
        void (async () => {
            try {
                await apply(desiredSlug);
                const user = await getMe();
                useAuthStore.getState().setUser(user);
            } catch {
                // Ім'я перехопили (рідко): підписка вже діє, відкриваємо поле.
                onTaken();
            }
        })();
    }, [isPaid, matches, desiredSlug, apply, onTaken]);
}
