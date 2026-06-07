'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { formatPrice } from '@finly/types';
import {
    UiModal,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
} from '@/shared/ui/UiModal';
import UiButton from '@/shared/ui/UiButton';
import UiRadioCardGroup from '@/shared/ui/UiRadioCardGroup';
import { cancelSubscription } from '@/shared/api/payments';
import { getMe, extractApiErrorCode } from '@/shared/api';
import { getApiMessage } from '@/shared/api/mapApiCode';
import { useAuthStore } from '@/entities/user';
import { formatLocalDate } from '@/shared/lib';
import { useCancelSubscriptionDialogStore } from './cancelSubscriptionDialogStore';

type CancelMode = 'period_end' | 'refund';

export default function CancelSubscriptionDialog() {
    const isOpen = useCancelSubscriptionDialogStore((s) => s.isOpen);
    const close = useCancelSubscriptionDialogStore((s) => s.close);
    const currentPeriodEnd = useCancelSubscriptionDialogStore(
        (s) => s.currentPeriodEnd
    );
    const [mode, setMode] = useState<CancelMode>('period_end');
    const [loading, setLoading] = useState(false);

    const handleOpenChange = (open: boolean) => {
        if (!open && !loading) {
            close();
            setMode('period_end');
        }
    };

    const handleConfirm = async () => {
        setLoading(true);
        try {
            const { refundedAmount } = await cancelSubscription(
                mode === 'refund'
            );
            const me = await getMe();
            useAuthStore.getState().setUser(me);
            close();
            setMode('period_end');
            if (refundedAmount && refundedAmount > 0) {
                toast.success(
                    `Підписку скасовано, повернемо ${formatPrice(refundedAmount, 'UAH')}`
                );
            } else if (mode === 'refund') {
                toast.success('Підписку скасовано');
            } else {
                toast.success(
                    'Підписку скасовано, доступ діє до кінця періоду'
                );
            }
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
                    <UiRadioCardGroup<CancelMode>
                        columns={{ mobile: 1, desktop: 2 }}
                        value={mode}
                        onChange={setMode}
                        options={[
                            {
                                value: 'period_end',
                                title: 'У кінці періоду',
                                description: periodLabel
                                    ? `Доступ діє до ${periodLabel}, далі підписка не поновлюється.`
                                    : 'Доступ діє до кінця періоду, далі підписка не поновлюється.',
                            },
                            {
                                value: 'refund',
                                title: 'З поверненням',
                                description:
                                    'Скасувати зараз і повернути кошти за невикористаний період.',
                            },
                        ]}
                    />

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
