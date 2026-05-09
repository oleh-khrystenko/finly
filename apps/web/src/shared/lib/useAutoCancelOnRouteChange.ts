'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Закриває (cancel-ить) глобальний overlay при зміні pathname-у. Інваріант
 * для overlay-ів, що тримають route-local closures у глобальному store
 * (наприклад callback-и cabinet-page-у, що замикають current `business`/
 * `invoice`): "global overlay живе тільки в межах одного pathname".
 *
 * **Проблема, яку це розвʼязує.** Overlay-store-и у `app/overlays.tsx`
 * mount-яться один раз на root-layout-i, але callback-и, що caller передає
 * у `open(...)`, замикають state route-page-component-а. Без cleanup-у:
 *  - ФОП відкриває confirm-dialog на бізнесі A, навігує на бізнес B.
 *  - Confirm-dialog лишається у store зі stale `onConfirm`-closure-ом.
 *  - Натискання Confirm викликає API на старому контексті (PATCH/DELETE
 *    бізнесу A, redirect у його cabinet — все на сторінці бізнесу B).
 *
 * **Як використовувати.** Викликати з overlay-component-а, що рендериться
 * у root `app/overlays.tsx`. Caller (overlay) знає семантику свого cancel-у
 * (resolve promise → false / тихий close / fire onCancel-callback) і
 * передає відповідну функцію.
 *
 * **Snapshot-ref `openedAtPathnameRef`** — без нього effect не міг би
 * розрізнити "відкрили dialog на цьому pathname-i, перший render після
 * open" від "dialog уже відкритий, користувач щойно навігував". Snapshot
 * фіксує pathname на момент open; пізніше effect порівнює актуальний з
 * ним і викликає cancel ТІЛЬКИ якщо pathname дійсно змінився відносно
 * snapshot-у.
 *
 * **Що НЕ покрито.** Зміни в межах одного pathname-у (param-change у
 * client-side navigation, що зберігає той самий route-pattern, але має
 * різні `[slug]`). У App Router-i `usePathname()` повертає resolved
 * pathname (`/business/foo` vs `/business/bar` — різні), тож наш
 * cabinet-flow покритий повністю. Якщо колись зʼявиться overlay,
 * відкритий на route з searchParam-залежним контекстом — додати окремий
 * snapshot на searchParams.
 */
export function useAutoCancelOnRouteChange(
    isOpen: boolean,
    cancel: () => void
): void {
    const pathname = usePathname();
    const openedAtPathnameRef = useRef<string | null>(null);
    useEffect(() => {
        if (isOpen) {
            if (openedAtPathnameRef.current === null) {
                openedAtPathnameRef.current = pathname;
            } else if (openedAtPathnameRef.current !== pathname) {
                cancel();
                openedAtPathnameRef.current = null;
            }
        } else {
            openedAtPathnameRef.current = null;
        }
    }, [isOpen, pathname, cancel]);
}
