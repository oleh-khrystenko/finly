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
import { updateCard } from '@/shared/api/payments';
import { getApiMessage } from '@/shared/api/mapApiCode';
import { extractApiErrorCode } from '@/shared/api';
import { formatLocalDate } from '@/shared/lib';
import UiButton from '@/shared/ui/UiButton';
import { useChangePlanDialogStore } from './changePlanDialogStore';
import { useCancelSubscriptionDialogStore } from './cancelSubscriptionDialogStore';
import { PLAN_COPY } from './catalogCopy';
import RecentPayments from './RecentPayments';

function statusBadge(billing: UserBilling): { label: string; cls: string } {
    if (billing.subscriptionStatus === SUBSCRIPTION_STATUS.PAST_DUE) {
        return { label: 'Прострочено', cls: 'bg-error/15 text-error' };
    }
    if (billing.cancelAtPeriodEnd) {
        return { label: 'Скасовується', cls: 'bg-warning/15 text-warning' };
    }
    // TRIALING після Sprint 19 — не trial (його прибрано), а відкладений старт
    // поверх активного one-off: картка привʼязана, перше списання на даті
    // закінчення one-off доступу.
    if (billing.subscriptionStatus === SUBSCRIPTION_STATUS.TRIALING) {
        return { label: 'Очікує старту', cls: 'bg-primary/15 text-primary' };
    }
    return { label: 'Активна', cls: 'bg-success/15 text-success' };
}

export default function ManageSubscription({
    catalog,
}: {
    catalog: PaymentsCatalog | null;
}) {
    const billing = useAuthStore((s) => s.user?.billing ?? null);
    const openChangePlan = useChangePlanDialogStore((s) => s.open);
    const openCancel = useCancelSubscriptionDialogStore((s) => s.open);
    const [cardLoading, setCardLoading] = useState(false);

    // Перезавантаження списку списань привʼязане до зміни стану підписки —
    // після cancel/change/re-bind. Прямий токен замість окремого
    // useState+useEffect уникає зайвого fetch на первинному mount.
    const reloadKey = `${billing?.subscriptionStatus}|${billing?.planCode}|${billing?.cancelAtPeriodEnd}|${billing?.scheduledPlanCode}`;

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

    const handleUpdateCard = async () => {
        setCardLoading(true);
        try {
            const { checkoutUrl } = await updateCard('/billing');
            window.location.assign(checkoutUrl);
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'payments'));
            setCardLoading(false);
        }
    };

    return (
        <section className="space-y-5">
            <h2 className="text-foreground text-2xl font-bold">
                Ваша підписка
            </h2>

            {isPastDue && (
                <div className="border-error/30 bg-error/10 text-error rounded-lg border p-4 text-sm">
                    Останнє списання не пройшло. Оновіть картку, щоб зберегти
                    доступ після завершення поточного періоду.
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
                        : billing.subscriptionStatus ===
                            SUBSCRIPTION_STATUS.TRIALING
                          ? `Перше списання ${formatLocalDate(billing.currentPeriodEnd)}`
                          : `Наступне списання ${formatLocalDate(billing.currentPeriodEnd)}`}
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

                {billing.scheduledPlanCode && (
                    <p className="text-muted-foreground mt-0.5 text-sm">
                        Перехід на{' '}
                        <span className="font-bold">
                            {planNameOf(billing.scheduledPlanCode)}
                        </span>{' '}
                        з {formatLocalDate(billing.scheduledChangeDate)}
                    </p>
                )}

                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    {!billing.cancelAtPeriodEnd && (
                        <UiButton
                            variant="outline"
                            size="md"
                            onClick={() =>
                                openChangePlan({
                                    plans: catalog?.subscriptionPlans ?? [],
                                    currentPlanCode: billing.planCode,
                                })
                            }
                            disabled={!catalog}
                        >
                            Змінити план
                        </UiButton>
                    )}
                    <UiButton
                        variant="outline"
                        size="md"
                        onClick={handleUpdateCard}
                        loading={cardLoading}
                    >
                        Оновити картку
                    </UiButton>
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
