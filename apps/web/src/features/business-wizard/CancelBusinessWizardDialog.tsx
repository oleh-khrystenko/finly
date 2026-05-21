'use client';

import { useAutoCancelOnRouteChange } from '@/shared/lib';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { useCancelBusinessWizardConfirmStore } from './cancelBusinessWizardConfirmStore';
import { useCancelWizardAction } from './useCancelWizardAction';

/**
 * Confirm-dialog скасування wizard-у. Зареєстрований у `app/overlays.tsx`.
 *
 * Cancel-flow інкапсульований у `useCancelWizardAction` (спільний з header-
 * кнопкою у `BusinessWizardForm` для skip-on-empty-сценарію). Тут діалог
 * тільки гейтить дію через "ти впевнений?".
 *
 * **`useAutoCancelOnRouteChange`** — глобальний overlay має закритись, якщо
 * користувач route-навігує (browser back, header-link) поки dialog
 * відкритий. Той самий patern, що `DeleteBusinessConfirmDialog`.
 */
export default function CancelBusinessWizardDialog() {
    const isOpen = useCancelBusinessWizardConfirmStore((s) => s.isOpen);
    const close = useCancelBusinessWizardConfirmStore((s) => s.close);
    const cancelWizard = useCancelWizardAction();

    useAutoCancelOnRouteChange(isOpen, close);

    const onConfirm = () => {
        close();
        cancelWizard();
    };

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={(o) => !o && close()}
            onConfirm={onConfirm}
            title="Скасувати створення бізнесу?"
            description="Введені дані буде втрачено. Цю дію не можна скасувати."
            confirmLabel="Так, скасувати"
            cancelLabel="Повернутись"
            variant="destructive"
        />
    );
}
