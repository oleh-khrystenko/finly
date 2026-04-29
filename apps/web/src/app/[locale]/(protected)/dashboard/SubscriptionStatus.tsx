'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { PaymentsCatalog } from '@neatslip/types';
import { getCatalog } from '@/shared/api/payments';
import { useAuthStore } from '@/entities/user';
import { formatLocalDate, toIntlLocale } from '@/shared/lib';
import UiLink from '@/shared/ui/UiLink';
import UiSectionCard from '@/shared/ui/UiSectionCard';

export default function SubscriptionStatus() {
    const t = useTranslations('dashboard_page.subscription');
    const tPlans = useTranslations('billing_page.plans');
    const locale = useLocale();
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
            ? catalog.subscriptionPlans.find(
                  (p) => p.code === billing.planCode
              )
            : null;

    const planName = billing?.planCode
        ? tPlans(`${billing.planCode}.name`, {
              defaultValue: billing.planCode,
          })
        : '';

    const billingLink = (
        <UiLink
            as="link"
            href={`/${locale}/billing`}
            className="text-sm font-medium"
        >
            {hasActive ? t('manage') : t('view_plans')}
        </UiLink>
    );

    return (
        <UiSectionCard title={t('label')} headerRight={billingLink}>
            {!hasActive ? (
                <p className="mt-3 text-sm text-muted-foreground">
                    {t('no_active')}
                </p>
            ) : (
                <div className="mt-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">
                            {t('plan_name', { plan: planName })}
                        </span>
                        <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                billing.cancelAtPeriodEnd
                                    ? 'bg-warning/15 text-warning'
                                    : 'bg-success/15 text-success'
                            }`}
                        >
                            {billing.cancelAtPeriodEnd
                                ? t('status_canceling')
                                : t('status_active')}
                        </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {billing.cancelAtPeriodEnd
                            ? t('cancels_on', {
                                  date: formatLocalDate(billing.currentPeriodEnd, locale),
                              })
                            : t('renews_on', {
                                  date: formatLocalDate(billing.currentPeriodEnd, locale),
                              })}
                    </p>
                    {activePlan && (
                        <p className="mt-0.5 text-sm text-muted-foreground">
                            {t('executions_per_period', {
                                count: activePlan.executions.toLocaleString(
                                    toIntlLocale(locale)
                                ),
                            })}
                        </p>
                    )}
                    {billing.scheduledPlanCode && (
                        <p className="mt-0.5 text-sm text-muted-foreground">
                            {t.rich('scheduled_change', {
                                plan: tPlans(
                                    `${billing.scheduledPlanCode}.name`,
                                    {
                                        defaultValue:
                                            billing.scheduledPlanCode,
                                    }
                                ),
                                date: formatLocalDate(
                                    billing.scheduledChangeDate ?? null,
                                    locale
                                ),
                                accent: (chunks) => (
                                    <span className="font-bold">
                                        {chunks}
                                    </span>
                                ),
                            })}
                        </p>
                    )}
                </div>
            )}
        </UiSectionCard>
    );
}
