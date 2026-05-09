'use client';

import { useAutoCancelOnRouteChange } from '@/shared/lib';
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
 * **Lifecycle cleanup на route-change (review fix)** — `useAutoCancelOnRoute-
 * Change`. Глобальний store тримає route-local closures (`onSave({ ... })`
 * у `InvoicesSettingsSection` — captures `business` slug). Без guard-а
 * confirm після переходу спрацював би проти старого контексту (PATCH на
 * старий бізнес). Resolve у `false` для caller, що unmount-ився, — no-op.
 */
export default function SlugPresetWarningDialog() {
    const isOpen = useSlugPresetWarningStore((s) => s.isOpen);
    const confirm = useSlugPresetWarningStore((s) => s.confirm);
    const cancel = useSlugPresetWarningStore((s) => s.cancel);

    useAutoCancelOnRouteChange(isOpen, cancel);

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
