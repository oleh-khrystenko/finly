'use client';

import { formatPrice } from '@finly/types';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { useCardChangeConfirmStore } from './cardChangeConfirmStore';

/**
 * Sprint 43 — попередження про суму перед заміною картки у стані боргу. Сама
 * прив'язка безгрошова (рахунок на нуль), але одразу після збереження картки
 * система списує прострочений місяць. Без цього екрана списання стало б
 * несподіванкою, і рішення «не вимагати другого натискання» втратило б силу.
 */
export default function CardChangeConfirmDialog() {
    const isOpen = useCardChangeConfirmStore((s) => s.isOpen);
    const close = useCardChangeConfirmStore((s) => s.close);
    const chargeAfterSave = useCardChangeConfirmStore((s) => s.chargeAfterSave);
    const currency = useCardChangeConfirmStore((s) => s.currency);
    const onConfirm = useCardChangeConfirmStore((s) => s.onConfirm);

    const handleOpenChange = (open: boolean) => {
        if (!open) close();
    };

    const handleConfirm = () => {
        close();
        onConfirm?.();
    };

    const description =
        `Введення картки не коштує нічого. Одразу після її збереження з неї ` +
        `буде списано ${formatPrice(chargeAfterSave, currency)} за поточний ` +
        `період, і доступ відновиться.`;

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={handleOpenChange}
            onConfirm={handleConfirm}
            title="Замінити картку і оплатити?"
            description={description}
            confirmLabel="Продовжити"
            cancelLabel="Скасувати"
        />
    );
}
