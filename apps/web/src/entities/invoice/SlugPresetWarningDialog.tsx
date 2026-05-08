'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { useSlugPresetWarningStore } from './slugPresetWarningStore';

/**
 * Sprint 4 §4.5 SP-1 + §4.4 — privacy-warning перед вибором `with-purpose`-
 * пресета (qr-decisions §4.3.1.1). Зареєстрований у `app/overlays.tsx`.
 * Власник: `entities/invoice` (FSD-shared bus між create/settings features).
 *
 * **Контракт зі store.** `confirm()` викликається з `onConfirm`-handler;
 * `cancel()` — з `onOpenChange(false)` (Cancel-кнопка, ESC, click-outside).
 * Обидва шляхи детерміновано викликають правильний callback із пари, що
 * caller передав у `open()`. Без `subscribe`-race-у на `isOpen`-зміну.
 *
 * **Lifecycle cleanup на route-change (review fix).** Глобальний store
 * тримає route-local closures (`onSave({ ... })` у `InvoicesSettingsSection`
 * — captures `business` slug). Якщо ФОП відкрив warning, навігував на інший
 * бізнес/сторінку і потім натиснув confirm — старий closure спрацював би
 * проти контексту, з якого вже вийшли (PATCH-чекладений на старий бізнес).
 * Інваріант: "global warning живе тільки в межах одного pathname". При зміні
 * pathname dialog авто-cancel-ить — onCancel-callback ловить race
 * детерміновано, як і будь-який intentional dismiss (ESC, click-outside).
 * Резолвить promise-у caller-а у `false` навіть коли той unmount-ився:
 * resolve на dead promise — no-op у React.
 */
export default function SlugPresetWarningDialog() {
    const isOpen = useSlugPresetWarningStore((s) => s.isOpen);
    const confirm = useSlugPresetWarningStore((s) => s.confirm);
    const cancel = useSlugPresetWarningStore((s) => s.cancel);

    const pathname = usePathname();
    // Snapshot останнього pathname-у, при якому dialog був відкритий. Без
    // snapshot-а `isOpen && pathname-changed` не розрізнити "відкрили на
    // цьому pathname-i" від "відкрили десь і pathname вже інший від mount-у".
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

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={(o) => {
                if (!o) cancel();
            }}
            onConfirm={confirm}
            title="Призначення платежу буде у URL"
            description="Якщо в призначенні написано «Оплата за роботу з Петренко» — у посиланні на оплату теж побачать «petrenko». Цей пресет краще обирати для нейтральних формулювань («послуги», «консультація»)."
            confirmLabel="Розумію, обираю"
            cancelLabel="Скасувати"
            variant="default"
        />
    );
}
