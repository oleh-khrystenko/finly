'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import {
    PAYMENTS_SUBSCRIPTION_ENABLED,
    PAYMENTS_ONE_OFF_ENABLED,
    BILLING_DEMO_MODE,
} from '@/shared/config/env';
import {
    getCatalog,
    createSubscriptionCheckout,
    createOneOffCheckout,
} from '@/shared/api/payments';
import { extractApiErrorCode, getApiMessage } from '@/shared/api';
import { useAuthStore } from '@/entities/user';
import {
    ManageSubscription,
    DemoBanner,
    PLAN_COPY,
    ONE_OFF_COPY,
    ACCESS_LEVEL_LABEL,
} from '@/features/billing';
import { formatPrice, type PaymentsCatalog } from '@finly/types';
import { formatLocalDate } from '@/shared/lib';
import UiButton from '@/shared/ui/UiButton';
import UiLink from '@/shared/ui/UiLink';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSpinner from '@/shared/ui/UiSpinner';

function intervalSuffix(interval: string): string {
    return interval === 'year' ? '/ рік' : '/ місяць';
}

export default function BillingPage() {
    const user = useAuthStore((s) => s.user);
    const [loadingAction, setLoadingAction] = useState<string | null>(null);
    const [catalog, setCatalog] = useState<PaymentsCatalog | null>(null);
    const [catalogLoading, setCatalogLoading] = useState(true);
    // Стабільний «зараз» на час життя компонента — порівняння дати one-off без
    // impure Date.now() у render-body (React purity).
    const [nowMs] = useState(() => Date.now());

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

    // Sprint 19 — активний one-off (рівень + дата). Підписка перекриває one-off
    // у видимості (ManageSubscription), тож банер one-off і фільтр карток —
    // лише коли підписки немає.
    const oneOffUntil = billing?.oneOffAccessUntil
        ? new Date(billing.oneOffAccessUntil)
        : null;
    const oneOffActive =
        !hasActive && oneOffUntil != null && oneOffUntil.getTime() > nowMs;
    const oneOffLevel = oneOffActive ? (billing?.oneOffLevel ?? null) : null;

    const handleSubscriptionCheckout = async (planCode: string) => {
        setLoadingAction(`subscribe_${planCode}`);
        try {
            const { checkoutUrl } = await createSubscriptionCheckout(planCode);
            window.location.assign(checkoutUrl);
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'payments'));
            setLoadingAction(null);
        }
    };

    const handleOneOffCheckout = async (oneOffCode: string) => {
        setLoadingAction(`oneoff_${oneOffCode}`);
        try {
            const { checkoutUrl } = await createOneOffCheckout(oneOffCode);
            window.location.assign(checkoutUrl);
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'payments'));
            setLoadingAction(null);
        }
    };

    // Активний one-off ховає однойменну one-off картку (тримаєш — не купуєш
    // повторно); показуємо інший one-off + підписки.
    const visibleOneOffs =
        catalog?.oneOffAccesses.filter(
            (o) => !(oneOffActive && o.level === oneOffLevel)
        ) ?? [];

    return (
        <UiPageContainer className="space-y-10 py-12">
            {BILLING_DEMO_MODE && <DemoBanner />}

            {/* ── Page Header ── */}
            <div>
                <UiPageHeading>Тариф</UiPageHeading>
                <p className="text-muted-foreground mt-2">
                    Керуйте підпискою та доступом. Усі платежі безпечно
                    обробляються через monobank.
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

            {/* ── Active One-off Access Banner (no subscription) ── */}
            {!catalogLoading && oneOffActive && oneOffLevel && (
                <div className="border-primary/30 bg-primary/10 rounded-xl border p-5">
                    <p className="text-foreground font-semibold">
                        Активний доступ: {ACCESS_LEVEL_LABEL[oneOffLevel]}
                    </p>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Діє до {formatLocalDate(oneOffUntil)}.
                    </p>
                </div>
            )}

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
                                                {plan.name}
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
                                                Підписатись на {plan.name}
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

            {/* ── One-off Monthly Access (no active subscription) ── */}
            {PAYMENTS_ONE_OFF_ENABLED &&
                !catalogLoading &&
                catalog &&
                !hasActive &&
                visibleOneOffs.length > 0 && (
                    <section>
                        <div className="mb-6">
                            <h2 className="text-foreground text-2xl font-bold">
                                Доступ на місяць
                            </h2>
                            <p className="text-muted-foreground mt-1 text-sm">
                                Разова оплата без автопродовження. Зручно
                                спробувати без підписки.
                            </p>
                        </div>

                        <div
                            className={`grid gap-6 ${visibleOneOffs.length === 1 ? '' : 'sm:grid-cols-2'}`}
                        >
                            {visibleOneOffs.map((access) => {
                                const copy = ONE_OFF_COPY[access.code];
                                return (
                                    <div
                                        key={access.code}
                                        className="border-border bg-card flex flex-col rounded-xl border p-5 md:p-6"
                                    >
                                        <div className="flex items-center justify-between">
                                            <p className="text-foreground text-base font-semibold">
                                                {access.name}
                                            </p>
                                            {access.featured && copy?.badge && (
                                                <span className="border-muted-foreground/25 bg-muted/50 text-muted-foreground rounded-full border px-3 py-0.5 text-xs font-medium">
                                                    {copy.badge}
                                                </span>
                                            )}
                                        </div>
                                        {copy?.tagline && (
                                            <p className="text-muted-foreground mt-1 text-sm">
                                                {copy.tagline}
                                            </p>
                                        )}

                                        <div className="border-border mt-5 flex items-center justify-between border-t pt-5">
                                            <p className="text-foreground text-xl font-bold">
                                                {formatPrice(
                                                    access.priceAmount,
                                                    access.currency
                                                )}
                                            </p>
                                            <UiButton
                                                variant={
                                                    access.featured
                                                        ? 'filled'
                                                        : 'outline'
                                                }
                                                size="md"
                                                className={`relative ${!access.featured ? 'border-primary text-primary hover:bg-primary/10 hover:text-primary hover:border-primary' : ''}`}
                                                onClick={() =>
                                                    handleOneOffCheckout(
                                                        access.code
                                                    )
                                                }
                                                disabled={
                                                    loadingAction ===
                                                    `oneoff_${access.code}`
                                                }
                                            >
                                                <span
                                                    className={
                                                        loadingAction ===
                                                        `oneoff_${access.code}`
                                                            ? 'invisible'
                                                            : ''
                                                    }
                                                >
                                                    Придбати
                                                </span>
                                                {loadingAction ===
                                                    `oneoff_${access.code}` && (
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
