'use client';

import type { PaymentsCatalog } from '@finly/types';
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

interface Props {
    /**
     * Pre-fetched catalog з parent-page. Pure presentation — компонент
     * НЕ робить власний `getCatalog()` (це б дублювало existing fetch у
     * `/billing/page.tsx`). `null` під час loading; UI деградує до
     * показу плану без `executions/period` рядка.
     */
    catalog: PaymentsCatalog | null;
}

/**
 * Sprint 3 §3.5 — компактна summary-картка стану підписки. Перенесена з
 * видаленого `dashboard/` у `features/billing/` (in-slice). Render-иться на
 * `/billing/page.tsx` зверху як короткий статус — детальна керуюча UI
 * (план-cards, "Керувати підпискою" button) живе нижче на тій же сторінці.
 *
 * Pure presentation — `billing` читається з `authStore` (single source у
 * сесії), `catalog` приходить як prop (parent уже fetch-ить його для cards).
 */
export default function SubscriptionStatus({ catalog }: Props) {
    const billing = useAuthStore((s) => s.user?.billing ?? null);

    const hasActive = billing?.hasActiveSubscription === true;

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
                <p className="text-muted-foreground mt-3 text-sm">
                    Немає активної підписки
                </p>
            ) : (
                <div className="mt-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-foreground font-semibold">
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
                    <p className="text-muted-foreground mt-1 text-sm">
                        {billing.cancelAtPeriodEnd
                            ? `Діє до ${formatLocalDate(billing.currentPeriodEnd)}`
                            : `Поновлення ${formatLocalDate(billing.currentPeriodEnd)}`}
                    </p>
                    {activePlan && (
                        <p className="text-muted-foreground mt-0.5 text-sm">
                            {activePlan.executions.toLocaleString(INTL_LOCALE)}{' '}
                            виконань за період
                        </p>
                    )}
                    {billing.scheduledPlanCode && (
                        <p className="text-muted-foreground mt-0.5 text-sm">
                            Перехід на{' '}
                            <span className="font-bold">
                                {formatPlanName(billing.scheduledPlanCode)}
                            </span>{' '}
                            з{' '}
                            {formatLocalDate(
                                billing.scheduledChangeDate ?? null
                            )}
                        </p>
                    )}
                </div>
            )}
        </UiSectionCard>
    );
}
