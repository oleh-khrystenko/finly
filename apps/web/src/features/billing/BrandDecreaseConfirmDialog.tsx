'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { BILLING_UNIVERSE, formatPrice } from '@finly/types';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { changeCapacity } from '@/shared/api/payments';
import { extractApiErrorCode, getApiMessage } from '@/shared/api';
import { useBrandDecreaseConfirmStore } from './brandDecreaseConfirmStore';

/**
 * Sprint 27 — підтвердження зменшення ємності Бренд-складу. Діє з наступного
 * списання (поточний цикл уже оплачено), без повернень; до межі циклу зменшення
 * можна скасувати повторним викликом з поточною ємністю.
 */
export default function BrandDecreaseConfirmDialog() {
    const isOpen = useBrandDecreaseConfirmStore((s) => s.isOpen);
    const close = useBrandDecreaseConfirmStore((s) => s.close);
    const newCapacity = useBrandDecreaseConfirmStore((s) => s.newCapacity);
    const keepBusinessIds = useBrandDecreaseConfirmStore(
        (s) => s.keepBusinessIds
    );
    const newMonthlyAmount = useBrandDecreaseConfirmStore(
        (s) => s.newMonthlyAmount
    );
    const currency = useBrandDecreaseConfirmStore((s) => s.currency);
    const onDone = useBrandDecreaseConfirmStore((s) => s.onDone);

    const [submitting, setSubmitting] = useState(false);

    const handleOpenChange = (open: boolean) => {
        if (!open && !submitting) close();
    };

    const handleConfirm = async () => {
        if (submitting) return;
        setSubmitting(true);
        try {
            await changeCapacity({
                universe: BILLING_UNIVERSE.BRAND,
                capacity: newCapacity,
                keepBusinessIds,
            });
            toast.success('Зменшення заплановано з наступного списання');
            close();
            onDone?.();
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'payments'));
        } finally {
            setSubmitting(false);
        }
    };

    const description =
        newCapacity === 0
            ? 'Бренд вимкнеться з наступного списання, кошти за поточний період не повертаються. До межі циклу зменшення можна скасувати.'
            : `Слот буде прибрано з наступного списання, кошти за поточний період не повертаються. Нове місячне списання: ${formatPrice(newMonthlyAmount, currency)}.`;

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={handleOpenChange}
            onConfirm={handleConfirm}
            title="Прибрати слот?"
            description={description}
            confirmLabel="Прибрати слот"
            cancelLabel="Скасувати"
            loading={submitting}
        />
    );
}
