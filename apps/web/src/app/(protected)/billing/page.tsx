'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import Image from 'next/image';
import {
    PAYMENTS_SUBSCRIPTION_ENABLED,
    PAYMENTS_ONE_OFF_ENABLED,
    BILLING_DEMO_MODE,
} from '@/shared/config/env';
import { INTL_LOCALE } from '@/shared/lib';
import {
    getCatalog,
    createSubscriptionCheckout,
    createOneOffCheckout,
} from '@/shared/api/payments';
import { useAuthStore } from '@/entities/user';
import {
    useBillingResetDialogStore,
    ManageSubscription,
    DemoBanner,
} from '@/features/billing';
import { formatPrice, type PaymentsCatalog } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiLink from '@/shared/ui/UiLink';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSpinner from '@/shared/ui/UiSpinner';

interface PlanCopy {
    name: string;
    tagline: string;
    badge?: string;
    features: string[];
}

// Плани різняться лише квотою виконань і ціною (per-tier feature-gating у
// продукті немає), тож перелік можливостей однаковий — квоту показує окремий
// рядок «виконань за період». Тримаємо копію правдивою: лише реальні
// можливості Finly, без вигаданих фіч на кшталт «команд» чи «аналітики».
const FINLY_FEATURES = [
    'Платіжні QR-коди за стандартом НБУ',
    'Брендовані QR з логотипом і рамкою',
    'Публічні сторінки оплати та платіжні посилання',
    'Кілька отримувачів і банківських реквізитів',
];

const PLAN_COPY: Record<string, PlanCopy> = {
    starter: {
        name: 'Starter',
        tagline: 'Для ФОП, що приймає оплати через QR',
        features: FINLY_FEATURES,
    },
    pro: {
        name: 'Pro',
        tagline: 'Для бухгалтерів і отримувачів з великим обігом',
        badge: 'Популярний',
        features: FINLY_FEATURES,
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
                toast.error('Не вдалося завантажити інформацію про ціни')
            )
            .finally(() => setCatalogLoading(false));
    }, []);

    if (!user) return null;

    const billing = user.billing;
    const hasActive = billing?.hasActiveSubscription === true;
    const hasBillingData = billing != null;

    const handleSubscriptionCheckout = async (planCode: string) => {
        setLoadingAction(`subscribe_${planCode}`);
        try {
            const { checkoutUrl } = await createSubscriptionCheckout(planCode);
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

    return (
        <UiPageContainer className="space-y-10 py-12">
            {/* ── Demo Banner ── */}
            {BILLING_DEMO_MODE && <DemoBanner />}

            {/* ── Page Header ── */}
            <div>
                <UiPageHeading>Білінг</UiPageHeading>
                <p className="text-muted-foreground mt-2">
                    Керуйте підпискою та виконаннями. Усі платежі безпечно
                    обробляються через WayForPay.
                </p>
            </div>

            {/* ── Catalog Loading ── */}
            {catalogLoading && (
                <div className="flex justify-center py-16">
                    <UiSpinner size="md" />
                </div>
            )}

            {/* ── Active Subscription Management ── */}
            {PAYMENTS_SUBSCRIPTION_ENABLED &&
                !catalogLoading &&
                catalog &&
                hasActive && <ManageSubscription catalog={catalog} />}

            {/* ── Subscription Plans (no active subscription) ── */}
            {PAYMENTS_SUBSCRIPTION_ENABLED &&
                !catalogLoading &&
                catalog &&
                !hasActive && (
                    <section>
                        <h2 className="text-foreground mb-6 text-2xl font-bold">
                            Оберіть план
                        </h2>

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
                                                plan.currency
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
                                            <li className="text-muted-foreground flex items-center gap-2 text-sm">
                                                <Check className="text-success h-4 w-4 shrink-0" />
                                                {plan.executions.toLocaleString(
                                                    INTL_LOCALE
                                                )}{' '}
                                                виконань за період
                                            </li>
                                            {(copy?.features ?? []).map(
                                                (feature, idx) => (
                                                    <li
                                                        key={idx}
                                                        className="text-muted-foreground flex items-center gap-2 text-sm"
                                                    >
                                                        <Check className="text-success h-4 w-4 shrink-0" />
                                                        {feature}
                                                    </li>
                                                )
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
                    </section>
                )}

            {/* ── Executions Section ── */}
            {PAYMENTS_ONE_OFF_ENABLED && !catalogLoading && catalog && (
                <section>
                    <div className="mb-6">
                        <h2 className="text-foreground text-2xl font-bold">
                            Пакети виконань
                        </h2>
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
                                                    pack.currency
                                                )}
                                            </p>
                                            <p className="text-muted-foreground text-xs">
                                                {pack.executions.toLocaleString(
                                                    INTL_LOCALE
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
                                Видаляє підписку, виконання та історію платежів
                                у WayForPay і в базі.
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
