'use client';

import { useEffect, useRef } from 'react';

import { RESPONSE_CODE } from '@finly/types';

import {
    extractApiErrorCode,
    getMe,
    releaseSlugReservation,
} from '@/shared/api';
import { useAuthStore } from './authStore';

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
    // Sprint 27 — чи цільовий бізнес брендований (per-business гейт), передається
    // caller-ом (`isBusinessBranded(business)`), а не з рівня користувача.
    isBranded: boolean;
    apply: (slug: string) => Promise<void>;
    onTaken: () => void;
}): void {
    const { matches, desiredSlug, isBranded, apply, onTaken } = opts;
    const doneRef = useRef(false);

    useEffect(() => {
        if (doneRef.current) return;
        if (!isBranded || !matches || !desiredSlug) return;
        doneRef.current = true;
        void (async () => {
            try {
                await apply(desiredSlug);
                const user = await getMe();
                useAuthStore.getState().setUser(user);
            } catch (err) {
                // Розрізняємо «ім'я перехопили» від транзієнтного збою rename-у
                // (мережа, 5xx, throttle). Лише SLUG_TAKEN означає, що бронь
                // мертва: тоді відкриваємо поле і знімаємо її. На будь-якій іншій
                // помилці бронь ще валідна, тож зберігаємо холд (auto-добивання
                // повториться на наступному mount; doneRef стримує повтор тут).
                if (extractApiErrorCode(err) !== RESPONSE_CODE.SLUG_TAKEN) return;
                // Ім'я перехопили (рідко): підписка вже діє, відкриваємо поле.
                onTaken();
                // Знімаємо мертву бронь і освіжаємо стор, інакше провальне
                // добивання повторювалось би з тим самим toast на кожному
                // наступному заході до спливу TTL (rename-fail НЕ споживає
                // бронь). Best-effort: doneRef стримує повтор у цьому mount.
                try {
                    await releaseSlugReservation();
                    const user = await getMe();
                    useAuthStore.getState().setUser(user);
                } catch {
                    // Стор лишаємо як є; повтор стримує doneRef до наступного mount.
                }
            }
        })();
    }, [isBranded, matches, desiredSlug, apply, onTaken]);
}
