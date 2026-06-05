'use client';

import { useAutoCancelOnRouteChange } from '@/shared/lib';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import {
    UiDangerGateDialog,
    type DangerGate,
} from '@/shared/ui/UiDangerGateDialog';
import { useDeleteBusinessConfirmStore } from './deleteBusinessConfirmStore';

/**
 * Confirm dialog для business-delete-flow. Зареєстрований у `app/overlays.tsx`.
 * Confirm закриває dialog і викликає callback (cabinet page орхеструє 5s undo +
 * actual cascade-delete у toast).
 *
 * **Дві гілки за вкладеним:**
 *  - є реквізити чи рахунки → `UiDangerGateDialog`: cascade зносить увесь граф,
 *    тому кнопка активується лише після того, як ФОП вписав кількість кожного
 *    ненульового рівня (1–2 поля). `invoicesCount > 0 ⇒ accountsCount > 0`
 *    (рахунки вкладені у реквізити), тож поля додаються незалежно.
 *  - порожній бізнес → простий `UiConfirmDialog`.
 *
 * **Lifecycle cleanup на route-change** — `useAutoCancelOnRouteChange`. Без
 * guard-а ФОП міг би відкрити confirm на бізнесі A, перейти на B, натиснути
 * Confirm — і запустити 5s-undo cascade-delete на A.
 */
export default function DeleteBusinessConfirmDialog() {
    const isOpen = useDeleteBusinessConfirmStore((s) => s.isOpen);
    const business = useDeleteBusinessConfirmStore((s) => s.business);
    const accountsCount = useDeleteBusinessConfirmStore((s) => s.accountsCount);
    const invoicesCount = useDeleteBusinessConfirmStore((s) => s.invoicesCount);
    const onConfirm = useDeleteBusinessConfirmStore((s) => s.onConfirm);
    const close = useDeleteBusinessConfirmStore((s) => s.close);

    useAutoCancelOnRouteChange(isOpen, close);

    const confirmAndClose = () => {
        onConfirm?.();
        close();
    };

    const hasNested = accountsCount > 0 || invoicesCount > 0;

    if (business && hasNested) {
        const hasInvoices = invoicesCount > 0;
        const gates: DangerGate[] = [
            { label: 'Реквізити', expected: String(accountsCount) },
        ];
        if (hasInvoices) {
            gates.push({
                label: 'Виставлені рахунки',
                expected: String(invoicesCount),
            });
        }

        const nestedPhrase = hasInvoices
            ? `усіма реквізитами (${accountsCount} шт) та виставленими рахунками (${invoicesCount} шт)`
            : `усіма реквізитами (${accountsCount} шт)`;

        return (
            <UiDangerGateDialog
                open={isOpen}
                onOpenChange={(o) => !o && close()}
                onConfirm={confirmAndClose}
                title="Видалити бізнес?"
                description={`«${business.name}» буде видалено остаточно разом з ${nestedPhrase}. Клієнти, які мають збережене посилання, не зможуть оплатити.`}
                gates={gates}
                renderPrompt={(input) =>
                    hasInvoices ? (
                        <>
                            Впишіть кількість реквізитів {input(0)} і рахунків{' '}
                            {input(1)}, щоб підтвердити видалення.
                        </>
                    ) : (
                        <>
                            Впишіть кількість реквізитів {input(0)}, щоб
                            підтвердити видалення.
                        </>
                    )
                }
                confirmLabel="Видалити"
                cancelLabel="Скасувати"
            />
        );
    }

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={(o) => !o && close()}
            onConfirm={confirmAndClose}
            title="Видалити бізнес?"
            description={
                business
                    ? `«${business.name}» буде видалено. Клієнти, які мають збережене посилання, не зможуть оплатити.`
                    : ''
            }
            confirmLabel="Видалити"
            cancelLabel="Скасувати"
            variant="destructive"
        />
    );
}
