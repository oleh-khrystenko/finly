'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CreditCard } from 'lucide-react';
import {
    SUBSCRIPTION_STATUS,
    type PaymentsCatalog,
    type UserBilling,
} from '@finly/types';
import { useAuthStore } from '@/entities/user';
import { formatLocalDate } from '@/shared/lib';
import { resumeSubscription } from '@/shared/api/payments';
import { extractApiErrorCode, getApiMessage } from '@/shared/api';
import UiButton from '@/shared/ui/UiButton';
import { useCancelSubscriptionDialogStore } from './cancelSubscriptionDialogStore';
import { PLAN_COPY } from './catalogCopy';
import RecentPayments from './RecentPayments';

function statusBadge(billing: UserBilling): { label: string; cls: string } {
    if (billing.subscriptionStatus === SUBSCRIPTION_STATUS.PAST_DUE) {
        return {
            label: 'Прострочено',
            cls: 'bg-destructive/15 text-destructive',
        };
    }
    if (billing.cancelAtPeriodEnd) {
        return { label: 'Скасовується', cls: 'bg-warning/15 text-warning' };
    }
    return { label: 'Активна', cls: 'bg-success/15 text-success' };
}

export default function ManageSubscription({
    catalog,
}: {
    catalog: PaymentsCatalog | null;
}) {
    const billing = useAuthStore((s) => s.user?.billing ?? null);
    const openCancel = useCancelSubscriptionDialogStore((s) => s.open);
    const [resuming, setResuming] = useState(false);

    // Перезавантаження списку списань привʼязане до зміни стану підписки.
    const reloadKey = `${billing?.subscriptionStatus}|${billing?.planCode}|${billing?.cancelAtPeriodEnd}`;

    const activePlan = useMemo(
        () =>
            catalog?.subscriptionPlans.find(
                (p) => p.code === billing?.planCode
            ),
        [catalog, billing?.planCode]
    );

    const planNameOf = (code: string | null): string => {
        if (!code) return '';
        return (
            catalog?.subscriptionPlans.find((p) => p.code === code)?.name ??
            code
        );
    };

    if (!billing?.hasActiveSubscription) return null;

    const badge = statusBadge(billing);
    const isPastDue =
        billing.subscriptionStatus === SUBSCRIPTION_STATUS.PAST_DUE;
    const planName = planNameOf(billing.planCode);

    const handleResume = async () => {
        setResuming(true);
        try {
            const { checkoutUrl } = await resumeSubscription();
            window.location.assign(checkoutUrl);
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'payments'));
            setResuming(false);
        }
    };

    return (
        <section className="space-y-5">
            <h2 className="text-foreground text-2xl font-bold">Ваша підписка</h2>

            {isPastDue && (
                <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
                    Останнє списання не пройшло. Доступ діятиме до кінця
                    грейс-вікна. Натисніть «Оплатити зараз», щоб погасити борг і
                    зберегти підписку.
                </div>
            )}

            <div className="border-border bg-card rounded-xl border p-5 md:p-6">
                <div className="flex flex-wrap items-center gap-3">
                    <p className="text-foreground text-lg font-semibold">
                        План {planName}
                    </p>
                    <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.cls}`}
                    >
                        {badge.label}
                    </span>
                </div>

                <p className="text-muted-foreground mt-1 text-sm">
                    {billing.cancelAtPeriodEnd
                        ? `Доступ діє до ${formatLocalDate(billing.currentPeriodEnd)}`
                        : isPastDue
                          ? 'Повторюємо списання найближчими днями'
                          : `Наступне списання ${formatLocalDate(billing.nextChargeAt)}`}
                </p>

                {activePlan && PLAN_COPY[activePlan.code]?.tagline && (
                    <p className="text-muted-foreground mt-0.5 text-sm">
                        {PLAN_COPY[activePlan.code].tagline}
                    </p>
                )}

                {billing.cardMask && (
                    <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-sm">
                        <CreditCard className="h-4 w-4" />
                        Картка {billing.cardMask}
                    </p>
                )}

                {!billing.cancelAtPeriodEnd && (
                    <p className="text-muted-foreground mt-3 text-xs">
                        Щоб змінити тариф, скасуйте підписку і оформіть нову
                        після завершення оплаченого періоду.
                    </p>
                )}

                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    {isPastDue && (
                        <UiButton
                            variant="filled"
                            size="md"
                            onClick={handleResume}
                            loading={resuming}
                        >
                            Оплатити зараз
                        </UiButton>
                    )}
                    {!billing.cancelAtPeriodEnd && (
                        <UiButton
                            variant="destructive-outline"
                            size="md"
                            onClick={() =>
                                openCancel(
                                    billing.currentPeriodEnd
                                        ? new Date(
                                              billing.currentPeriodEnd
                                          ).toISOString()
                                        : null
                                )
                            }
                        >
                            Скасувати підписку
                        </UiButton>
                    )}
                </div>
            </div>

            <RecentPayments reloadKey={reloadKey} />
        </section>
    );
}
