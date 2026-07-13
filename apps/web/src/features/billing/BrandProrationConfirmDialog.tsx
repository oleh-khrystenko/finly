'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { BILLING_UNIVERSE, formatPrice } from '@finly/types';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { changeCapacity } from '@/shared/api/payments';
import { extractApiErrorCode, getApiMessage } from '@/shared/api';
import { useBrandProrationConfirmStore } from './brandProrationConfirmStore';

/**
 * Sprint 27 — підтвердження пропорційної доплати за новий Бренд-слот. Один
 * запит: слот і прикріплення отримувача застосовуються атомарно з оплатою,
 * обірваний другий крок неможливий. `scheduled: true` — банк повернув
 * нетермінальний статус: ефект застосує billing-clock після підтвердження,
 * тож користувачу чесно кажемо «обробляється», а не «додано».
 */
export default function BrandProrationConfirmDialog() {
    const isOpen = useBrandProrationConfirmStore((s) => s.isOpen);
    const close = useBrandProrationConfirmStore((s) => s.close);
    const businessId = useBrandProrationConfirmStore((s) => s.businessId);
    const newCapacity = useBrandProrationConfirmStore((s) => s.newCapacity);
    const immediateCharge = useBrandProrationConfirmStore(
        (s) => s.immediateCharge
    );
    const newMonthlyAmount = useBrandProrationConfirmStore(
        (s) => s.newMonthlyAmount
    );
    const currency = useBrandProrationConfirmStore((s) => s.currency);
    const onDone = useBrandProrationConfirmStore((s) => s.onDone);

    const [submitting, setSubmitting] = useState(false);

    const handleOpenChange = (open: boolean) => {
        if (!open && !submitting) close();
    };

    const handleConfirm = async () => {
        if (submitting || !businessId) return;
        setSubmitting(true);
        try {
            const result = await changeCapacity({
                universe: BILLING_UNIVERSE.BRAND,
                capacity: newCapacity,
                attachBusinessId: businessId,
            });
            if (result.scheduled) {
                toast.info(
                    "Банк обробляє оплату. Слот з'явиться після підтвердження"
                );
            } else {
                toast.success('Слот додано, отримувача прикріплено');
            }
            close();
            onDone?.();
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'payments'));
        } finally {
            setSubmitting(false);
        }
    };

    const description =
        `Вільних слотів немає. Зараз спишеться ${formatPrice(immediateCharge, currency)} ` +
        `пропорційно за дні до кінця циклу. Наступне місячне списання: ` +
        `${formatPrice(newMonthlyAmount, currency)}.`;

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={handleOpenChange}
            onConfirm={handleConfirm}
            title="Додати слот"
            description={description}
            confirmLabel="Додати і сплатити"
            cancelLabel="Скасувати"
            loading={submitting}
        />
    );
}
