'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
    SUBSCRIPTION_PLAN_CODES,
    formatPrice,
    type SubscriptionPlanCode,
} from '@finly/types';
import {
    UiModal,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
} from '@/shared/ui/UiModal';
import UiButton from '@/shared/ui/UiButton';
import UiRadioCardGroup from '@/shared/ui/UiRadioCardGroup';
import { changePlan } from '@/shared/api/payments';
import { getMe, extractApiErrorCode } from '@/shared/api';
import { getApiMessage } from '@/shared/api/mapApiCode';
import { useAuthStore } from '@/entities/user';
import { useChangePlanDialogStore } from './changePlanDialogStore';
import { PLAN_COPY } from './catalogCopy';

function isPlanCode(value: string): value is SubscriptionPlanCode {
    return (SUBSCRIPTION_PLAN_CODES as readonly string[]).includes(value);
}

export default function ChangePlanDialog() {
    const isOpen = useChangePlanDialogStore((s) => s.isOpen);
    const close = useChangePlanDialogStore((s) => s.close);
    const plans = useChangePlanDialogStore((s) => s.plans);
    const currentPlanCode = useChangePlanDialogStore((s) => s.currentPlanCode);

    const [selected, setSelected] = useState<SubscriptionPlanCode | undefined>(
        undefined
    );
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isOpen) setSelected(undefined);
    }, [isOpen]);

    const current = plans.find((p) => p.code === currentPlanCode);
    const target = plans.find((p) => p.code === selected);
    const isUpgrade =
        current && target ? target.priceAmount > current.priceAmount : false;

    const handleOpenChange = (open: boolean) => {
        if (!open && !loading) close();
    };

    const handleConfirm = async () => {
        if (!selected) return;
        setLoading(true);
        try {
            const { scheduled } = await changePlan(selected);
            const me = await getMe();
            useAuthStore.getState().setUser(me);
            close();
            toast.success(
                scheduled
                    ? 'План зміниться з наступного періоду'
                    : 'План змінено, доплату списано'
            );
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'payments'));
        } finally {
            setLoading(false);
        }
    };

    const options = plans
        .filter((p) => p.code !== currentPlanCode)
        .filter((p) => isPlanCode(p.code))
        .map((p) => ({
            value: p.code as SubscriptionPlanCode,
            title: `${p.name}, ${formatPrice(p.priceAmount, p.currency)}${p.interval === 'year' ? '/рік' : '/міс'}`,
            description: PLAN_COPY[p.code]?.tagline ?? '',
        }));

    return (
        <UiModal open={isOpen} onOpenChange={handleOpenChange}>
            <UiModalContent>
                <UiModalHeader>
                    <UiModalTitle>Зміна плану</UiModalTitle>
                </UiModalHeader>
                <div className="space-y-5 px-4 pb-6">
                    <UiRadioCardGroup<SubscriptionPlanCode>
                        columns={{ mobile: 1 }}
                        value={selected}
                        onChange={setSelected}
                        options={options}
                    />

                    {target && (
                        <p className="text-muted-foreground text-sm">
                            {isUpgrade
                                ? 'Апгрейд застосується одразу: спишемо доплату за залишок періоду за збереженою карткою.'
                                : 'Зниження плану застосується з наступного періоду, поточний доступ збережеться до межі.'}
                        </p>
                    )}

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
                            variant="filled"
                            size="md"
                            onClick={handleConfirm}
                            disabled={!selected}
                            loading={loading}
                        >
                            {isUpgrade
                                ? 'Оплатити і змінити'
                                : 'Запланувати зміну'}
                        </UiButton>
                    </div>
                </div>
            </UiModalContent>
        </UiModal>
    );
}
