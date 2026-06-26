'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
    UiModal,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
} from '@/shared/ui/UiModal';
import UiButton from '@/shared/ui/UiButton';
import { cancelSubscription } from '@/shared/api/payments';
import { getMe, extractApiErrorCode } from '@/shared/api';
import { getApiMessage } from '@/shared/api/mapApiCode';
import { useAuthStore } from '@/entities/user';
import { formatLocalDate } from '@/shared/lib';
import { useCancelSubscriptionDialogStore } from './cancelSubscriptionDialogStore';

/**
 * Sprint 22 — скасування лише у кінці періоду (refund і зміна тарифу зрізані).
 * Доступ доживає оплачений період; повторне списання припиняється.
 */
export default function CancelSubscriptionDialog() {
    const isOpen = useCancelSubscriptionDialogStore((s) => s.isOpen);
    const close = useCancelSubscriptionDialogStore((s) => s.close);
    const currentPeriodEnd = useCancelSubscriptionDialogStore(
        (s) => s.currentPeriodEnd
    );
    const [loading, setLoading] = useState(false);

    const handleOpenChange = (open: boolean) => {
        if (!open && !loading) close();
    };

    const handleConfirm = async () => {
        setLoading(true);
        try {
            await cancelSubscription();
            const me = await getMe();
            useAuthStore.getState().setUser(me);
            close();
            toast.success('Підписку скасовано, доступ діє до кінця періоду');
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'payments'));
        } finally {
            setLoading(false);
        }
    };

    const periodLabel = currentPeriodEnd
        ? formatLocalDate(currentPeriodEnd)
        : null;

    return (
        <UiModal open={isOpen} onOpenChange={handleOpenChange}>
            <UiModalContent>
                <UiModalHeader>
                    <UiModalTitle>Скасування підписки</UiModalTitle>
                </UiModalHeader>
                <div className="space-y-5 px-4 pb-6">
                    <p className="text-muted-foreground text-sm">
                        {periodLabel
                            ? `Доступ діятиме до ${periodLabel}, далі підписка не поновлюється. Щоб перейти на інший тариф, після завершення періоду оформіть нову підписку.`
                            : 'Доступ діятиме до кінця оплаченого періоду, далі підписка не поновлюється.'}
                    </p>

                    <div className="flex justify-end gap-3">
                        <UiButton
                            type="button"
                            variant="text"
                            size="md"
                            onClick={() => handleOpenChange(false)}
                            disabled={loading}
                        >
                            Назад
                        </UiButton>
                        <UiButton
                            type="button"
                            variant="destructive-outline"
                            size="md"
                            onClick={handleConfirm}
                            loading={loading}
                        >
                            Скасувати підписку
                        </UiButton>
                    </div>
                </div>
            </UiModalContent>
        </UiModal>
    );
}
