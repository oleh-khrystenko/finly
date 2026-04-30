'use client';

import { useEffect, useState } from 'react';
import type { PaymentsCatalog } from '@neatslip/types';
import { getCatalog } from '@/shared/api/payments';
import { useAuthStore } from '@/entities/user';
import { formatLocalDate, INTL_LOCALE } from '@/shared/lib';
import UiLink from '@/shared/ui/UiLink';
import UiSectionCard from '@/shared/ui/UiSectionCard';

const PLAN_NAMES: Record<string, string> = {
    starter: 'Starter',
    pro: 'Pro',
};

function formatPlanName(code: string | null | undefined): string {
    if (!code) return '';
    return PLAN_NAMES[code] ?? code;
}

export default function SubscriptionStatus() {
    const billing = useAuthStore((s) => s.user?.billing ?? null);

    const hasActive = billing?.hasActiveSubscription === true;

    const [catalog, setCatalog] = useState<PaymentsCatalog | null>(null);

    useEffect(() => {
        if (!hasActive) return;
        getCatalog()
            .then(setCatalog)
            .catch(() => {});
    }, [hasActive]);

    const activePlan =
        hasActive && catalog
            ? catalog.subscriptionPlans.find((p) => p.code === billing.planCode)
            : null;

    const planName = formatPlanName(billing?.planCode);

    const billingLink = (
        <UiLink as="link" href="/billing" className="text-sm font-medium">
            {hasActive ? 'Керувати' : 'Переглянути плани'}
        </UiLink>
    );

    return (
        <UiSectionCard title="Підписка" headerRight={billingLink}>
            {!hasActive ? (
                <p className="mt-3 text-sm text-muted-foreground">
                    Немає активної підписки
                </p>
            ) : (
                <div className="mt-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">
                            План {planName}
                        </span>
                        <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                billing.cancelAtPeriodEnd
                                    ? 'bg-warning/15 text-warning'
                                    : 'bg-success/15 text-success'
                            }`}
                        >
                            {billing.cancelAtPeriodEnd
                                ? 'Скасовується'
                                : 'Активна'}
                        </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {billing.cancelAtPeriodEnd
                            ? `Діє до ${formatLocalDate(billing.currentPeriodEnd)}`
                            : `Поновлення ${formatLocalDate(billing.currentPeriodEnd)}`}
                    </p>
                    {activePlan && (
                        <p className="mt-0.5 text-sm text-muted-foreground">
                            {activePlan.executions.toLocaleString(INTL_LOCALE)}{' '}
                            виконань за період
                        </p>
                    )}
                    {billing.scheduledPlanCode && (
                        <p className="mt-0.5 text-sm text-muted-foreground">
                            Перехід на{' '}
                            <span className="font-bold">
                                {formatPlanName(billing.scheduledPlanCode)}
                            </span>{' '}
                            з{' '}
                            {formatLocalDate(
                                billing.scheduledChangeDate ?? null,
                            )}
                        </p>
                    )}
                </div>
            )}
        </UiSectionCard>
    );
}
