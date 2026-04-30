'use client';

import { useEffect, useState } from 'react';
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
import { formatLocalDate, INTL_LOCALE } from '@/shared/lib';
import { useBillingResetDialogStore } from '@/features/billing';
import { formatPrice, type PaymentsCatalog } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiLink from '@/shared/ui/UiLink';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSpinner from '@/shared/ui/UiSpinner';
import { DemoBanner } from '@/features/billing';

interface PlanCopy {
    name: string;
    tagline: string;
    badge?: string;
    features: string[];
}

const PLAN_COPY: Record<string, PlanCopy> = {
    starter: {
        name: 'Starter',
        tagline: 'Для невеликих команд на старті',
        features: [
            'До 5 учасників команди',
            '10 000 виконань/місяць',
            'Базова аналітика',
            'Підтримка через email',
        ],
    },
    pro: {
        name: 'Pro',
        tagline: 'Для зростаючого бізнесу',
        badge: 'Популярний',
        features: [
            'Необмежена кількість учасників',
            '50 000 виконань/місяць',
            'Розширена аналітика',
            'Пріоритетна підтримка',
            'Кастомні інтеграції',
        ],
    },
};

interface PackCopy {
    name: string;
    tagline: string;
    badge?: string;
}

const PACK_COPY: Record<string, PackCopy> = {
    basic: {
        name: 'Basic Pack',
        tagline: 'Швидке поповнення для миттєвих потреб',
    },
    max: {
        name: 'Max Pack',
        tagline: 'Найвигідніше для використання за потребою',
        badge: 'Вигода',
    },
};

function planName(code: string): string {
    return PLAN_COPY[code]?.name ?? code;
}

function packName(code: string): string {
    return PACK_COPY[code]?.name ?? code;
}

function intervalSuffix(interval: string): string {
    return interval === 'year' ? '/ рік' : '/ місяць';
}

export default function BillingPage() {
    const user = useAuthStore((s) => s.user);
    const [loadingAction, setLoadingAction] = useState<string | null>(null);
    const [catalog, setCatalog] = useState<PaymentsCatalog | null>(null);
    const openResetDialog = useBillingResetDialogStore((s) => s.open);
    const [catalogLoading, setCatalogLoading] = useState(true);

    useEffect(() => {
        getCatalog()
            .then(setCatalog)
            .catch(() =>
                toast.error('Не вдалося завантажити інформацію про ціни'),
            )
            .finally(() => setCatalogLoading(false));
    }, []);

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
            toast.error('Не вдалося створити сесію оплати');
            setLoadingAction(null);
        }
    };

    const handleOneOffCheckout = async (packCode: string) => {
        setLoadingAction(`oneoff_${packCode}`);
        try {
            const { checkoutUrl } = await createOneOffCheckout(packCode);
            window.location.assign(checkoutUrl);
        } catch {
            toast.error('Не вдалося створити сесію оплати');
            setLoadingAction(null);
        }
    };

    const handlePortal = async () => {
        setLoadingAction('portal');
        try {
            const { portalUrl } = await createPortalSession();
            window.location.assign(portalUrl);
        } catch {
            toast.error('Не вдалося відкрити портал керування');
            setLoadingAction(null);
        }
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
                <UiPageHeading>Білінг</UiPageHeading>
                <p className="text-muted-foreground mt-2">
                    Керуйте підпискою та виконаннями. Усі платежі безпечно
                    обробляються через Stripe.
                </p>
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
                        {hasActive ? 'Ваша підписка' : 'Оберіть план'}
                    </h2>

                    {!hasActive ? (
                        <div
                            className={`grid gap-6 ${catalog.subscriptionPlans.length === 1 ? '' : 'sm:grid-cols-2'}`}
                        >
                            {catalog.subscriptionPlans.map((plan) => {
                                const copy = PLAN_COPY[plan.code];
                                return (
                                    <div
                                        key={plan.code}
                                        className="border-border bg-card flex flex-col rounded-xl border p-6 md:p-8"
                                    >
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-foreground text-xl font-bold">
                                                {planName(plan.code)}
                                            </h3>
                                            {plan.featured && copy?.badge && (
                                                <span className="border-muted-foreground/25 bg-muted/50 text-muted-foreground rounded-full border px-3 py-0.5 text-xs font-medium">
                                                    {copy.badge}
                                                </span>
                                            )}
                                        </div>

                                        <p className="text-foreground mt-3 text-4xl font-bold tracking-tight">
                                            {formatPrice(
                                                plan.priceAmount,
                                                plan.currency,
                                            )}
                                            <span className="text-muted-foreground text-lg font-normal">
                                                {' '}
                                                {intervalSuffix(plan.interval)}
                                            </span>
                                        </p>

                                        {copy?.tagline && (
                                            <p className="text-muted-foreground mt-2 text-sm">
                                                {copy.tagline}
                                            </p>
                                        )}

                                        <ul className="mt-6 flex-1 space-y-3">
                                            {(copy?.features ?? []).map(
                                                (feature, idx) => (
                                                    <li
                                                        key={idx}
                                                        className="text-muted-foreground flex items-center gap-2 text-sm"
                                                    >
                                                        <Check className="text-success h-4 w-4 shrink-0" />
                                                        {feature}
                                                    </li>
                                                ),
                                            )}
                                        </ul>

                                        <UiButton
                                            variant={
                                                plan.featured
                                                    ? 'filled'
                                                    : 'outline'
                                            }
                                            size="lg"
                                            className={`relative mt-8 w-full justify-center ${!plan.featured ? 'border-primary text-primary hover:bg-primary/10 hover:text-primary hover:border-primary' : ''}`}
                                            onClick={() =>
                                                handleSubscriptionCheckout(
                                                    plan.code,
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
                                                Підписатись на{' '}
                                                {planName(plan.code)}
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
                                );
                            })}
                        </div>
                    ) : (
                        <div className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:gap-5 md:p-5">
                            {billing?.planCode && (
                                <div className="relative aspect-square w-14 shrink-0 overflow-hidden rounded-md sm:w-20">
                                    <Image
                                        src={`/images/plans/${billing.planCode}-light.svg`}
                                        alt={planName(billing.planCode)}
                                        fill
                                        className="block object-cover dark:hidden"
                                    />
                                    <Image
                                        src={`/images/plans/${billing.planCode}-dark.svg`}
                                        alt={planName(billing.planCode)}
                                        fill
                                        className="hidden object-cover dark:block"
                                    />
                                </div>
                            )}

                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                                    <p className="text-foreground text-base font-semibold">
                                        План{' '}
                                        {billing?.planCode
                                            ? planName(billing.planCode)
                                            : ''}
                                    </p>
                                    <span className="bg-success/15 text-success rounded-full px-2.5 py-0.5 text-xs font-medium">
                                        {billing?.cancelAtPeriodEnd
                                            ? `Активна до ${formatLocalDate(billing?.currentPeriodEnd ?? null)}`
                                            : 'Активна'}
                                    </span>
                                </div>

                                <p className="text-muted-foreground mt-1 text-sm">
                                    {billing?.cancelAtPeriodEnd
                                        ? 'Підписку буде скасовано після завершення поточного періоду.'
                                        : billing?.currentPeriodEnd
                                          ? `Наступне списання ${formatLocalDate(billing.currentPeriodEnd)}`
                                          : null}
                                </p>
                                {!billing?.cancelAtPeriodEnd && activePlan && (
                                    <p className="text-muted-foreground mt-0.5 text-sm">
                                        {activePlan.executions.toLocaleString(
                                            INTL_LOCALE,
                                        )}{' '}
                                        виконань за період
                                    </p>
                                )}
                                {billing?.scheduledPlanCode && (
                                    <p className="text-muted-foreground mt-0.5 text-sm">
                                        Перехід на{' '}
                                        <span className="font-bold">
                                            {planName(
                                                billing.scheduledPlanCode,
                                            )}
                                        </span>{' '}
                                        з{' '}
                                        {formatLocalDate(
                                            billing.scheduledChangeDate ?? null,
                                        )}
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
                                    Керувати підпискою
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
                            Пакети виконань
                        </h2>
                        <p className="text-muted-foreground text-sm">
                            Ваш баланс:{' '}
                            <span className="text-primary font-semibold">
                                {user.executions.balance.toLocaleString('en-US')}
                            </span>{' '}
                            виконань
                        </p>
                    </div>

                    <div
                        className={`grid gap-6 ${catalog.executionPacks.length <= 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}
                    >
                        {catalog.executionPacks.map((pack) => {
                            const copy = PACK_COPY[pack.code];
                            return (
                                <div
                                    key={pack.code}
                                    className="border-border bg-card flex flex-col rounded-xl border p-5 md:p-6"
                                >
                                    {/* ── Upper: image + name + badge ── */}
                                    <div className="flex items-center gap-4">
                                        <div className="relative aspect-square w-14 shrink-0 overflow-hidden rounded-lg">
                                            <Image
                                                src={`/images/packs/${pack.code}-light.svg`}
                                                alt={packName(pack.code)}
                                                fill
                                                className="block object-cover dark:hidden"
                                            />
                                            <Image
                                                src={`/images/packs/${pack.code}-dark.svg`}
                                                alt={packName(pack.code)}
                                                fill
                                                className="hidden object-cover dark:block"
                                            />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between">
                                                <p className="text-foreground text-base font-semibold">
                                                    {packName(pack.code)}
                                                </p>
                                                {pack.featured &&
                                                    copy?.badge && (
                                                        <span className="border-muted-foreground/25 bg-muted/50 text-muted-foreground rounded-full border px-3 py-0.5 text-xs font-medium">
                                                            {copy.badge}
                                                        </span>
                                                    )}
                                            </div>
                                            {copy?.tagline && (
                                                <p className="text-muted-foreground mt-0.5 text-sm">
                                                    {copy.tagline}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {/* ── Lower: price + executions + button ── */}
                                    <div className="border-border mt-5 flex items-center justify-between border-t pt-5">
                                        <div>
                                            <p className="text-foreground text-xl font-bold">
                                                {formatPrice(
                                                    pack.priceAmount,
                                                    pack.currency,
                                                )}
                                            </p>
                                            <p className="text-muted-foreground text-xs">
                                                {pack.executions.toLocaleString(
                                                    'en-US',
                                                )}{' '}
                                                виконань
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
                                                Придбати
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
                            );
                        })}
                    </div>
                </section>
            )}

            {/* ── Reset Billing ── */}
            {hasBillingData && (
                <section className="border-border border-t pt-8">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                            <h2 className="text-foreground text-lg font-semibold">
                                Скинути білінг
                            </h2>
                            <p className="text-muted-foreground mt-1 text-sm">
                                Видаляє підписки, виконання та історію платежів
                                у Stripe і в базі.
                            </p>
                        </div>
                        <UiButton
                            variant="destructive-outline"
                            size="md"
                            className="w-full shrink-0 sm:w-auto"
                            onClick={openResetDialog}
                        >
                            Скинути білінг
                        </UiButton>
                    </div>
                </section>
            )}

            {/* ── Terms Note ── */}
            <p className="text-muted-foreground text-center text-xs">
                Продовжуючи, ви погоджуєтесь з{' '}
                <UiLink
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="primary-underline"
                >
                    умовами оплати
                </UiLink>
                .
            </p>
        </UiPageContainer>
    );
}
