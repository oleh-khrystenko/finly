'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ExternalLink } from 'lucide-react';

import {
    PAYMENTS_SUBSCRIPTION_ENABLED,
    PAYMENTS_ONE_OFF_ENABLED,
} from '@/shared/config/env';
import {
    getCatalog,
    createSubscriptionCheckout,
    createOneOffCheckout,
    createPortalSession,
} from '@/shared/api/payments';
import { useAuthStore } from '@/entities/user';
import { formatLocalDate } from '@/shared/lib';
import { formatPrice, type PaymentsCatalog } from '@cyanship/types';
import UiButton from '@/shared/ui/UiButton';
import UiSpinner from '@/shared/ui/UiSpinner';
import { DemoBanner } from '@/features/billing';

type SubTab = 'plans' | 'packs';

interface ProofBillingProps {
    onRequestAuth?: () => void;
}

const ProofBilling = ({ onRequestAuth }: ProofBillingProps) => {
    const t = useTranslations('landing_page.dogfooding.proof_billing');
    const tBilling = useTranslations('billing_page');
    const locale = useLocale();

    const user = useAuthStore((s) => s.user);
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

    const [catalog, setCatalog] = useState<PaymentsCatalog | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingAction, setLoadingAction] = useState<string | null>(null);
    const [hasError, setHasError] = useState(false);

    const billing = user?.billing;
    const hasActiveSubscription = billing?.hasActiveSubscription === true;

    const showBothTabs = PAYMENTS_SUBSCRIPTION_ENABLED && PAYMENTS_ONE_OFF_ENABLED;
    const [activeSubTab, setActiveSubTab] = useState<SubTab>(
        PAYMENTS_SUBSCRIPTION_ENABLED ? 'plans' : 'packs',
    );

    useEffect(() => {
        getCatalog()
            .then(setCatalog)
            .catch(() => setHasError(true))
            .finally(() => setIsLoading(false));
    }, []);

    const plans = useMemo(
        () =>
            catalog?.subscriptionPlans
                .toSorted((a, b) => a.displayOrder - b.displayOrder) ?? [],
        [catalog],
    );

    const packs = useMemo(
        () =>
            catalog?.executionPacks
                .toSorted((a, b) => a.displayOrder - b.displayOrder) ?? [],
        [catalog],
    );

    const activePlan = useMemo(
        () => plans.find((p) => p.code === billing?.planCode),
        [plans, billing?.planCode],
    );

    const handleCheckout = async (type: 'subscription' | 'oneoff', code: string) => {
        if (!isAuthenticated) {
            onRequestAuth?.();
            return;
        }

        const actionKey = type === 'subscription' ? `subscribe_${code}` : `oneoff_${code}`;
        setLoadingAction(actionKey);

        try {
            const returnPath = `/${locale}#dogfooding-usage`;
            const { checkoutUrl } =
                type === 'subscription'
                    ? await createSubscriptionCheckout(code, returnPath)
                    : await createOneOffCheckout(code, returnPath);

            window.location.assign(checkoutUrl);
        } catch {
            toast.error(
                type === 'subscription'
                    ? tBilling('subscribe.error')
                    : tBilling('executions.error'),
            );
            setLoadingAction(null);
        }
    };

    const handlePortal = async () => {
        setLoadingAction('portal');
        try {
            const { portalUrl } = await createPortalSession();
            window.location.assign(portalUrl);
        } catch {
            toast.error(tBilling('active.manage_error'));
            setLoadingAction(null);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <UiSpinner size="md" />
            </div>
        );
    }

    if (hasError || !catalog) {
        return (
            <div className="py-12 text-center">
                <p className="text-muted-foreground text-sm">{t('error')}</p>
            </div>
        );
    }

    const isEmpty =
        (!PAYMENTS_SUBSCRIPTION_ENABLED || plans.length === 0) &&
        (!PAYMENTS_ONE_OFF_ENABLED || packs.length === 0);

    if (isEmpty) {
        return (
            <div className="py-12 text-center">
                <p className="text-muted-foreground text-sm">{t('error')}</p>
            </div>
        );
    }

    const isActionInProgress = loadingAction !== null;
    const isPortalLoading = loadingAction === 'portal';

    return (
        <div className="w-full space-y-4">
            <DemoBanner />

            {showBothTabs && (
                <div role="tablist" className="flex gap-1 rounded-lg bg-muted p-1">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeSubTab === 'plans'}
                        className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                            activeSubTab === 'plans'
                                ? 'bg-card text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                        onClick={() => setActiveSubTab('plans')}
                    >
                        {t('plans_tab')}
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeSubTab === 'packs'}
                        className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                            activeSubTab === 'packs'
                                ? 'bg-card text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                        onClick={() => setActiveSubTab('packs')}
                    >
                        {t('packs_tab')}
                    </button>
                </div>
            )}

            {activeSubTab === 'plans' && PAYMENTS_SUBSCRIPTION_ENABLED && (
                <div role="tabpanel">
                    {hasActiveSubscription ? (
                        <div className="rounded-xl border border-border p-5">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-foreground">
                                    {tBilling('active.plan_name', {
                                        plan: billing?.planCode
                                            ? tBilling(`plans.${billing.planCode}.name`, {
                                                  defaultValue: billing.planCode,
                                              })
                                            : '',
                                    })}
                                </p>
                                <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-[10px] font-medium text-success">
                                    {billing?.cancelAtPeriodEnd
                                        ? tBilling('active.status_canceling', {
                                              date: formatLocalDate(billing.currentPeriodEnd, locale),
                                          })
                                        : tBilling('active.status_active')}
                                </span>
                            </div>

                            {activePlan && (
                                <p className="mt-3 text-2xl font-bold tracking-tight text-foreground">
                                    {formatPrice(activePlan.priceAmount, activePlan.currency)}
                                    <span className="text-sm font-normal text-muted-foreground">
                                        {' '}{tBilling(`subscribe.interval_${activePlan.interval}`)}
                                    </span>
                                </p>
                            )}

                            <UiButton
                                variant="outline"
                                size="sm"
                                IconRight={!isPortalLoading ? <ExternalLink /> : undefined}
                                className="relative mt-4 w-full justify-center"
                                onClick={handlePortal}
                                disabled={isActionInProgress}
                            >
                                <span className={isPortalLoading ? 'invisible' : ''}>
                                    {tBilling('active.manage_button')}
                                </span>
                                {isPortalLoading && (
                                    <UiSpinner
                                        size="sm"
                                        className="absolute inset-0 m-auto"
                                    />
                                )}
                            </UiButton>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-4">
                            {plans.map((plan) => {
                                const actionKey = `subscribe_${plan.code}`;
                                const isBusy = loadingAction === actionKey;

                                return (
                                    <div
                                        key={plan.code}
                                        className="flex flex-col rounded-xl border border-border p-5"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-sm font-semibold text-foreground">
                                                {tBilling(`plans.${plan.code}.name`, {
                                                    defaultValue: plan.code,
                                                })}
                                            </p>
                                            {plan.featured && (
                                                <span className="hidden rounded-full border border-muted-foreground/25 bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground min-[412px]:inline">
                                                    {tBilling(`plans.${plan.code}.badge`)}
                                                </span>
                                            )}
                                        </div>

                                        <p className="mt-3 text-2xl font-bold tracking-tight text-foreground">
                                            {formatPrice(plan.priceAmount, plan.currency)}
                                            <span className="text-sm font-normal text-muted-foreground">
                                                {' '}{tBilling(`subscribe.interval_${plan.interval}`)}
                                            </span>
                                        </p>

                                        <UiButton
                                            variant={plan.featured ? 'filled' : 'outline'}
                                            size="sm"
                                            className={`relative mt-4 w-full justify-center ${!plan.featured ? 'border-primary text-primary hover:border-primary hover:bg-primary/10 hover:text-primary' : ''}`}
                                            onClick={() => handleCheckout('subscription', plan.code)}
                                            disabled={isActionInProgress}
                                        >
                                            <span className={isBusy ? 'invisible' : ''}>
                                                {t('subscribe_button')}
                                            </span>
                                            {isBusy && (
                                                <UiSpinner
                                                    size="sm"
                                                    className="absolute inset-0 m-auto"
                                                />
                                            )}
                                        </UiButton>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {activeSubTab === 'packs' && PAYMENTS_ONE_OFF_ENABLED && (
                <div role="tabpanel" className="grid grid-cols-2 gap-4">
                    {packs.map((pack) => {
                        const actionKey = `oneoff_${pack.code}`;
                        const isBusy = loadingAction === actionKey;

                        return (
                            <div
                                key={pack.code}
                                className="flex flex-col rounded-xl border border-border p-5"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-sm font-semibold text-foreground">
                                        {tBilling(`packs.${pack.code}.name`, {
                                            defaultValue: pack.code,
                                        })}
                                    </p>
                                    {pack.featured && (
                                        <span className="hidden rounded-full border border-muted-foreground/25 bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground min-[412px]:inline">
                                            {tBilling(`packs.${pack.code}.badge`)}
                                        </span>
                                    )}
                                </div>

                                <p className="mt-3 text-2xl font-bold tracking-tight text-foreground">
                                    {formatPrice(pack.priceAmount, pack.currency)}
                                    <span className="text-sm font-normal text-muted-foreground">
                                        {' · '}
                                        {pack.executions.toLocaleString('en-US')}
                                        <span className="hidden lg:inline">
                                            {' '}
                                            {tBilling('packs.executions_label')}
                                        </span>
                                    </span>
                                </p>

                                <UiButton
                                    variant={pack.featured ? 'filled' : 'outline'}
                                    size="sm"
                                    className={`relative mt-4 w-full justify-center ${!pack.featured ? 'border-primary text-primary hover:border-primary hover:bg-primary/10 hover:text-primary' : ''}`}
                                    onClick={() => handleCheckout('oneoff', pack.code)}
                                    disabled={isActionInProgress}
                                >
                                    <span className={isBusy ? 'invisible' : ''}>
                                        {t('buy_button')}
                                    </span>
                                    {isBusy && (
                                        <UiSpinner
                                            size="sm"
                                            className="absolute inset-0 m-auto"
                                        />
                                    )}
                                </UiButton>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default ProofBilling;
