'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, ExternalLink } from 'lucide-react';
import Image from 'next/image';
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
import { formatLocalDate, toIntlLocale } from '@/shared/lib';
import { useBillingResetDialogStore } from '@/features/billing';
import { formatPrice, type PaymentsCatalog } from '@cyanship/types';
import UiButton from '@/shared/ui/UiButton';
import UiLink from '@/shared/ui/UiLink';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSpinner from '@/shared/ui/UiSpinner';
import { DemoBanner } from '@/features/billing';

export default function BillingPage() {
    const t = useTranslations('billing_page');
    const locale = useLocale();
    const user = useAuthStore((s) => s.user);
    const [loadingAction, setLoadingAction] = useState<string | null>(null);
    const [catalog, setCatalog] = useState<PaymentsCatalog | null>(null);
    const openResetDialog = useBillingResetDialogStore((s) => s.open);
    const [catalogLoading, setCatalogLoading] = useState(true);

    useEffect(() => {
        getCatalog()
            .then(setCatalog)
            .catch(() => toast.error(t('catalog_error')))
            .finally(() => setCatalogLoading(false));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    if (!user) return null;

    const billing = user.billing;
    const hasActive = billing?.hasActiveSubscription === true;
    const hasBillingData = billing != null || user.executions.balance > 0;

    const handleSubscriptionCheckout = async (planCode: string) => {
        setLoadingAction(`subscribe_${planCode}`);
        try {
            const { checkoutUrl } =
                await createSubscriptionCheckout(planCode);
            window.location.assign(checkoutUrl);
        } catch {
            toast.error(t('subscribe.error'));
            setLoadingAction(null);
        }
    };

    const handleOneOffCheckout = async (packCode: string) => {
        setLoadingAction(`oneoff_${packCode}`);
        try {
            const { checkoutUrl } = await createOneOffCheckout(packCode);
            window.location.assign(checkoutUrl);
        } catch {
            toast.error(t('executions.error'));
            setLoadingAction(null);
        }
    };

    const handlePortal = async () => {
        setLoadingAction('portal');
        try {
            const { portalUrl } = await createPortalSession();
            window.location.assign(portalUrl);
        } catch {
            toast.error(t('active.manage_error'));
            setLoadingAction(null);
        }
    };

    const planFeatureKeys: Record<string, readonly string[]> = {
        starter: ['item_1', 'item_2', 'item_3', 'item_4'],
        pro: ['item_1', 'item_2', 'item_3', 'item_4', 'item_5'],
    };

    const activePlan = catalog?.subscriptionPlans.find(
        (p) => p.code === billing?.planCode,
    );


    return (
        <UiPageContainer className="space-y-10 py-12">
            {/* ── Demo Banner ── */}
            <DemoBanner />

            {/* ── Page Header ── */}
            <div>
                <UiPageHeading>{t('heading')}</UiPageHeading>
                <p className="text-muted-foreground mt-2">{t('description')}</p>
            </div>

            {/* ── Catalog Loading ── */}
            {catalogLoading && (
                <div className="flex justify-center py-16">
                    <UiSpinner size="md" />
                </div>
            )}

            {/* ── Subscription Section ── */}
            {PAYMENTS_SUBSCRIPTION_ENABLED && !catalogLoading && catalog && (
                <section>
                    <h2 className="text-foreground mb-6 text-2xl font-bold">
                        {hasActive
                            ? t('active.heading')
                            : t('subscribe.heading')}
                    </h2>

                    {!hasActive ? (
                        <div
                            className={`grid gap-6 ${catalog.subscriptionPlans.length === 1 ? '' : 'sm:grid-cols-2'}`}
                        >
                            {catalog.subscriptionPlans.map((plan) => (
                                <div
                                    key={plan.code}
                                    className="border-border bg-card flex flex-col rounded-xl border p-6 md:p-8"
                                >
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-foreground text-xl font-bold">
                                            {t(`plans.${plan.code}.name`, {
                                                defaultValue: plan.code,
                                            })}
                                        </h3>
                                        {plan.featured && (
                                            <span className="border-muted-foreground/25 bg-muted/50 text-muted-foreground rounded-full border px-3 py-0.5 text-xs font-medium">
                                                {t(
                                                    `plans.${plan.code}.badge`
                                                )}
                                            </span>
                                        )}
                                    </div>

                                    <p className="text-foreground mt-3 text-4xl font-bold tracking-tight">
                                        {formatPrice(
                                            plan.priceAmount,
                                            plan.currency
                                        )}
                                        <span className="text-muted-foreground text-lg font-normal">
                                            {' '}
                                            {t(
                                                `subscribe.interval_${plan.interval}`
                                            )}
                                        </span>
                                    </p>

                                    <p className="text-muted-foreground mt-2 text-sm">
                                        {t(`plans.${plan.code}.tagline`)}
                                    </p>

                                    <ul className="mt-6 flex-1 space-y-3">
                                        {(
                                            planFeatureKeys[plan.code] ?? []
                                        ).map((key) => (
                                            <li
                                                key={key}
                                                className="text-muted-foreground flex items-center gap-2 text-sm"
                                            >
                                                <Check className="text-success h-4 w-4 shrink-0" />
                                                {t(
                                                    `plans.${plan.code}.features.${key}`
                                                )}
                                            </li>
                                        ))}
                                    </ul>

                                    <UiButton
                                        variant={
                                            plan.featured ? 'filled' : 'outline'
                                        }
                                        size="lg"
                                        className={`relative mt-8 w-full justify-center ${!plan.featured ? 'border-primary text-primary hover:bg-primary/10 hover:text-primary hover:border-primary' : ''}`}
                                        onClick={() =>
                                            handleSubscriptionCheckout(
                                                plan.code
                                            )
                                        }
                                        disabled={
                                            loadingAction ===
                                            `subscribe_${plan.code}`
                                        }
                                    >
                                        <span
                                            className={
                                                loadingAction ===
                                                `subscribe_${plan.code}`
                                                    ? 'invisible'
                                                    : ''
                                            }
                                        >
                                            {t('subscribe.button', {
                                                plan: t(
                                                    `plans.${plan.code}.name`,
                                                    {
                                                        defaultValue:
                                                            plan.code,
                                                    }
                                                ),
                                            })}
                                        </span>
                                        {loadingAction ===
                                            `subscribe_${plan.code}` && (
                                            <UiSpinner
                                                size="sm"
                                                className="absolute inset-0 m-auto"
                                            />
                                        )}
                                    </UiButton>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:gap-5 md:p-5">
                            {billing?.planCode && (
                                <div className="relative aspect-square w-14 shrink-0 overflow-hidden rounded-md sm:w-20">
                                    <Image
                                        src={`/images/plans/${billing.planCode}-light.svg`}
                                        alt={t(
                                            `plans.${billing.planCode}.name`,
                                            { defaultValue: billing.planCode }
                                        )}
                                        fill
                                        className="block object-cover dark:hidden"
                                    />
                                    <Image
                                        src={`/images/plans/${billing.planCode}-dark.svg`}
                                        alt={t(
                                            `plans.${billing.planCode}.name`,
                                            { defaultValue: billing.planCode }
                                        )}
                                        fill
                                        className="hidden object-cover dark:block"
                                    />
                                </div>
                            )}

                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                                    <p className="text-foreground text-base font-semibold">
                                        {t('active.plan_name', {
                                            plan: billing?.planCode
                                                ? t(
                                                      `plans.${billing.planCode}.name`,
                                                      {
                                                          defaultValue:
                                                              billing.planCode,
                                                      }
                                                  )
                                                : '',
                                        })}
                                    </p>
                                    <span className="bg-success/15 text-success rounded-full px-2.5 py-0.5 text-xs font-medium">
                                        {billing?.cancelAtPeriodEnd
                                            ? t('active.status_canceling', {
                                                  date: formatLocalDate(
                                                      billing?.currentPeriodEnd ??
                                                          null,
                                                      locale
                                                  ),
                                              })
                                            : t('active.status_active')}
                                    </span>
                                </div>

                                <p className="text-muted-foreground mt-1 text-sm">
                                    {billing?.cancelAtPeriodEnd
                                        ? t('active.cancel_notice')
                                        : billing?.currentPeriodEnd
                                          ? t('active.next_billing', {
                                                date: formatLocalDate(
                                                    billing.currentPeriodEnd,
                                                    locale
                                                ),
                                            })
                                          : null}
                                </p>
                                {!billing?.cancelAtPeriodEnd && activePlan && (
                                    <p className="text-muted-foreground mt-0.5 text-sm">
                                        {t('active.executions_per_period', {
                                            count: activePlan.executions.toLocaleString(
                                                toIntlLocale(locale)
                                            ),
                                        })}
                                    </p>
                                )}
                                {billing?.scheduledPlanCode && (
                                    <p className="text-muted-foreground mt-0.5 text-sm">
                                        {t.rich('active.scheduled_change', {
                                            plan: t(
                                                `plans.${billing.scheduledPlanCode}.name`,
                                                {
                                                    defaultValue:
                                                        billing.scheduledPlanCode,
                                                }
                                            ),
                                            date: formatLocalDate(
                                                billing.scheduledChangeDate ??
                                                    null,
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

                            <UiButton
                                variant="outline"
                                size="sm"
                                IconRight={
                                    loadingAction !== 'portal' ? (
                                        <ExternalLink />
                                    ) : undefined
                                }
                                className="relative w-full justify-center sm:w-auto sm:shrink-0"
                                onClick={handlePortal}
                                disabled={loadingAction === 'portal'}
                            >
                                <span
                                    className={
                                        loadingAction === 'portal'
                                            ? 'invisible'
                                            : ''
                                    }
                                >
                                    {t('active.manage_button')}
                                </span>
                                {loadingAction === 'portal' && (
                                    <UiSpinner
                                        size="sm"
                                        className="absolute inset-0 m-auto"
                                    />
                                )}
                            </UiButton>
                        </div>
                    )}
                </section>
            )}

            {/* ── Executions Section ── */}
            {PAYMENTS_ONE_OFF_ENABLED && !catalogLoading && catalog && (
                <section>
                    <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                        <h2 className="text-foreground text-2xl font-bold">
                            {t('executions.title')}
                        </h2>
                        <p className="text-muted-foreground text-sm">
                            {t.rich('executions.balance', {
                                count: user.executions.balance.toLocaleString(
                                    'en-US'
                                ),
                                accent: (chunks) => (
                                    <span className="text-primary font-semibold">
                                        {chunks}
                                    </span>
                                ),
                            })}
                        </p>
                    </div>

                    <div
                        className={`grid gap-6 ${catalog.executionPacks.length <= 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}
                    >
                        {catalog.executionPacks.map((pack) => (
                            <div
                                key={pack.code}
                                className="border-border bg-card flex flex-col rounded-xl border p-5 md:p-6"
                            >
                                {/* ── Upper: image + name + badge ── */}
                                <div className="flex items-center gap-4">
                                    <div className="relative aspect-square w-14 shrink-0 overflow-hidden rounded-lg">
                                        <Image
                                            src={`/images/packs/${pack.code}-light.svg`}
                                            alt={t(`packs.${pack.code}.name`)}
                                            fill
                                            className="block object-cover dark:hidden"
                                        />
                                        <Image
                                            src={`/images/packs/${pack.code}-dark.svg`}
                                            alt={t(`packs.${pack.code}.name`)}
                                            fill
                                            className="hidden object-cover dark:block"
                                        />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between">
                                            <p className="text-foreground text-base font-semibold">
                                                {t(`packs.${pack.code}.name`)}
                                            </p>
                                            {pack.featured && (
                                                <span className="border-muted-foreground/25 bg-muted/50 text-muted-foreground rounded-full border px-3 py-0.5 text-xs font-medium">
                                                    {t(`packs.${pack.code}.badge`)}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-muted-foreground mt-0.5 text-sm">
                                            {t(`packs.${pack.code}.tagline`)}
                                        </p>
                                    </div>
                                </div>

                                {/* ── Lower: price + executions + button ── */}
                                <div className="border-border mt-5 flex items-center justify-between border-t pt-5">
                                    <div>
                                        <p className="text-foreground text-xl font-bold">
                                            {formatPrice(
                                                pack.priceAmount,
                                                pack.currency
                                            )}
                                        </p>
                                        <p className="text-muted-foreground text-xs">
                                            {t('packs.executions_count', {
                                                count: pack.executions.toLocaleString('en-US'),
                                            })}
                                        </p>
                                    </div>
                                    <UiButton
                                        variant={
                                            pack.featured
                                                ? 'filled'
                                                : 'outline'
                                        }
                                        size="md"
                                        className={`relative ${!pack.featured ? 'border-primary text-primary hover:bg-primary/10 hover:text-primary hover:border-primary' : ''}`}
                                        onClick={() =>
                                            handleOneOffCheckout(pack.code)
                                        }
                                        disabled={
                                            loadingAction ===
                                            `oneoff_${pack.code}`
                                        }
                                    >
                                        <span
                                            className={
                                                loadingAction ===
                                                `oneoff_${pack.code}`
                                                    ? 'invisible'
                                                    : ''
                                            }
                                        >
                                            {t('executions.buy_button')}
                                        </span>
                                        {loadingAction ===
                                            `oneoff_${pack.code}` && (
                                            <UiSpinner
                                                size="sm"
                                                className="absolute inset-0 m-auto"
                                            />
                                        )}
                                    </UiButton>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* ── Reset Billing ── */}
            {hasBillingData && (
                <section className="border-border border-t pt-8">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                            <h2 className="text-foreground text-lg font-semibold">
                                {t('reset.button')}
                            </h2>
                            <p className="text-muted-foreground mt-1 text-sm">
                                {t('reset.description')}
                            </p>
                        </div>
                        <UiButton
                            variant="destructive-outline"
                            size="md"
                            className="w-full shrink-0 sm:w-auto"
                            onClick={openResetDialog}
                        >
                            {t('reset.button')}
                        </UiButton>
                    </div>
                </section>
            )}

            {/* ── Terms Note ── */}
            <p className="text-muted-foreground text-center text-xs">
                {t.rich('checkout_terms_note', {
                    terms: (chunks) => (
                        <UiLink
                            href={`/${locale}/terms`}
                            target="_blank"
                            rel="noopener noreferrer"
                            variant="primary-underline"
                        >
                            {chunks}
                        </UiLink>
                    ),
                })}
            </p>
        </UiPageContainer>
    );
}
