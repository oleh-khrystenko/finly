'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { SubscriptionPlanCode } from '@finly/types';
import { useAuthStore } from '@/entities/user';
import UiButton from '@/shared/ui/UiButton';
import {
    startSubscriptionCheckout,
    useSubscribeLabel,
} from './subscribeUpsell';

interface Props {
    planCode: SubscriptionPlanCode;
    /** Куди повернутись після оплати (сторінка, з якої прийшов апсел). */
    returnPath: string;
    /** Вихід без покупки (третя, текстова дія). */
    exitHref: string;
    exitLabel: string;
}

/**
 * Ряд дій апсел-пропозиції: «Підписатись · ціна» (прямий checkout з
 * поверненням), «Всі тарифи» (`/billing`), вихід без покупки. При активній
 * підписці кнопка прямого checkout ховається: API 409-ить нову підписку на
 * живому слоті (`ALREADY_SUBSCRIBED`), а зміни тарифу немає (Sprint 22) —
 * primary тоді стає перехід на білінг, де кейс веде `ManageSubscription`.
 */
export default function SubscribeActions({
    planCode,
    returnPath,
    exitHref,
    exitLabel,
}: Props) {
    const hasActiveSubscription = useAuthStore(
        (s) => s.user?.billing?.hasActiveSubscription === true
    );
    const subscribeLabel = useSubscribeLabel(planCode);
    const [redirecting, setRedirecting] = useState(false);

    const handleSubscribe = () => {
        setRedirecting(true);
        startSubscriptionCheckout(planCode, returnPath).catch(() => {
            setRedirecting(false);
            toast.error('Не вдалося відкрити оплату. Спробуйте ще раз');
        });
    };

    return (
        <div className="flex flex-wrap items-center gap-3">
            {!hasActiveSubscription && (
                <UiButton
                    type="button"
                    variant="filled"
                    size="md"
                    loading={redirecting}
                    onClick={handleSubscribe}
                >
                    {subscribeLabel}
                </UiButton>
            )}
            <UiButton
                as="link"
                href="/billing"
                variant={hasActiveSubscription ? 'filled' : 'outline'}
                size="md"
            >
                Всі тарифи
            </UiButton>
            <UiButton as="link" href={exitHref} variant="text" size="md">
                {exitLabel}
            </UiButton>
        </div>
    );
}
