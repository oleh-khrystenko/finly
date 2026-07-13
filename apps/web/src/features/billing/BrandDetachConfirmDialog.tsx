'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { BILLING_UNIVERSE } from '@finly/types';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { detachBusiness } from '@/shared/api/payments';
import { extractApiErrorCode, getApiMessage } from '@/shared/api';
import { useBrandDetachConfirmStore } from './brandDetachConfirmStore';

/**
 * Sprint 27 — підтвердження відкріплення отримувача від Бренд-складу.
 * Деструктивне: логотип згасає, власні посилання скидаються на випадкові без
 * відновлення. Слот звільняється, сума списання не змінюється (ціна = ємність).
 */
export default function BrandDetachConfirmDialog() {
    const isOpen = useBrandDetachConfirmStore((s) => s.isOpen);
    const close = useBrandDetachConfirmStore((s) => s.close);
    const businessId = useBrandDetachConfirmStore((s) => s.businessId);
    const businessName = useBrandDetachConfirmStore((s) => s.businessName);
    const onDone = useBrandDetachConfirmStore((s) => s.onDone);

    const [submitting, setSubmitting] = useState(false);

    const handleOpenChange = (open: boolean) => {
        if (!open && !submitting) close();
    };

    const handleConfirm = async () => {
        if (submitting || !businessId) return;
        setSubmitting(true);
        try {
            await detachBusiness({
                universe: BILLING_UNIVERSE.BRAND,
                businessId,
            });
            toast.success('Отримувача відкріплено, слот звільнено');
            close();
            onDone?.();
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'payments'));
        } finally {
            setSubmitting(false);
        }
    };

    const description =
        `Логотип отримувача «${businessName}» згасне, а власні посилання буде ` +
        `скинуто на випадкові (повернути їх не можна). Слот звільниться, сума ` +
        `списання не зміниться.`;

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={handleOpenChange}
            onConfirm={handleConfirm}
            title="Відкріпити отримувача?"
            description={description}
            confirmLabel="Відкріпити"
            cancelLabel="Скасувати"
            variant="destructive"
            loading={submitting}
        />
    );
}
