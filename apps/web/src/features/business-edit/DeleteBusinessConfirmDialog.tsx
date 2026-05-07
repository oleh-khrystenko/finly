'use client';

import { pluralizeUa } from '@/shared/lib';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { useDeleteBusinessConfirmStore } from './deleteBusinessConfirmStore';

/**
 * Sprint 3 §3.8 + Sprint 4 §SP-5 — confirm dialog для delete-flow.
 * Зареєстрований у `app/overlays.tsx`. Confirm закриває dialog і викликає
 * callback (cabinet page орхеструє 5s undo + actual delete у toast).
 *
 * **`invoicesCount > 0` → warning-рядок** (Sprint 4 §SP-5): cascade-delete
 * видалить усі invoices разом з business у одній transaction; ФОП має
 * знати цифру **до** натискання "Видалити". UA-плюрал ("1 рахунок" /
 * "2 рахунки" / "5 рахунків") — той самий patern, що `BusinessCard`-counter.
 *
 * **Без слова "активних"** — counter рахує **усі** invoice-документи, включно
 * з expired (узгоджено з `BusinessCard`-комент `apps/web/src/app/(protected)/
 * business/page.tsx`). "Активний" вводив би в оману у destructive-confirmation.
 */

export default function DeleteBusinessConfirmDialog() {
    const isOpen = useDeleteBusinessConfirmStore((s) => s.isOpen);
    const business = useDeleteBusinessConfirmStore((s) => s.business);
    const invoicesCount = useDeleteBusinessConfirmStore(
        (s) => s.invoicesCount,
    );
    const onConfirm = useDeleteBusinessConfirmStore((s) => s.onConfirm);
    const close = useDeleteBusinessConfirmStore((s) => s.close);

    let description = '';
    if (business) {
        description = `«${business.name}» буде видалено. Клієнти, які мають збережене посилання, не зможуть оплатити.`;
        if (invoicesCount > 0) {
            const counter = pluralizeUa(
                invoicesCount,
                'рахунок',
                'рахунки',
                'рахунків',
            );
            description += ` У бізнесу ${counter} — вони теж зникнуть.`;
        }
    }

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={(o) => !o && close()}
            onConfirm={() => {
                onConfirm?.();
                close();
            }}
            title="Видалити бізнес?"
            description={description}
            confirmLabel="Видалити"
            cancelLabel="Скасувати"
            variant="destructive"
        />
    );
}
