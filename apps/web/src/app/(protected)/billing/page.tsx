'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import {
    SUBSCRIPTION_STATUS,
    formatPrice,
    type BillingCatalog,
    type BillingProfileView,
    type BusinessWithCounts,
} from '@finly/types';
import { BILLING_DEMO_MODE } from '@/shared/config/env';
import {
    getBillingProfile,
    getCatalog,
    resumeSubscription,
} from '@/shared/api/payments';
import {
    extractApiErrorCode,
    getApiMessage,
    listBusinesses,
} from '@/shared/api';
import { formatLocalDate } from '@/shared/lib';
import {
    BrandUniverseCard,
    DemoBanner,
    DocumentsUniverseCard,
    RecentPayments,
    useCancelSubscriptionDialogStore,
} from '@/features/billing';
import UiButton from '@/shared/ui/UiButton';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';

export default function BillingPage() {
    const [profile, setProfile] = useState<BillingProfileView | null>(null);
    const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
    const [businesses, setBusinesses] = useState<BusinessWithCounts[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [resuming, setResuming] = useState(false);

    const openCancel = useCancelSubscriptionDialogStore((s) => s.open);

    const reloadProfile = useCallback(() => {
        getBillingProfile()
            .then((p) => setProfile(p))
            .catch(() => toast.error('Не вдалося оновити стан підписки'));
        setReloadKey((k) => k + 1);
    }, []);

    useEffect(() => {
        let active = true;
        Promise.all([
            getBillingProfile(),
            getCatalog(),
            listBusinesses('own'),
            listBusinesses('client'),
        ])
            .then(([p, c, own, client]) => {
                if (!active) return;
                setProfile(p);
                setCatalog(c);
                // Об'єднуємо власні + клієнтські (дедуп за id) для пікера бренду.
                const map = new Map<string, BusinessWithCounts>();
                for (const b of [...own, ...client]) map.set(b.id, b);
                setBusinesses([...map.values()]);
            })
            .catch(() => {
                if (active) setFailed(true);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    // Перезавантажуємо профіль після закриття діалогу скасування (діяв чи ні).
    // Підписка на store замість effect-на-стані: setState лише у callback
    // зовнішньої підписки (вимога react-hooks lint).
    useEffect(() => {
        let prevOpen = useCancelSubscriptionDialogStore.getState().isOpen;
        return useCancelSubscriptionDialogStore.subscribe((s) => {
            if (prevOpen && !s.isOpen) reloadProfile();
            prevOpen = s.isOpen;
        });
    }, [reloadProfile]);

    const handleResume = async () => {
        setResuming(true);
        try {
            const { checkoutUrl } = await resumeSubscription('/billing');
            window.location.href = checkoutUrl;
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'payments'));
            setResuming(false);
        }
    };

    return (
        <UiPageContainer className="max-w-3xl space-y-6 py-10 md:py-14">
            <UiPageHeading className="md:text-4xl">Тарифи</UiPageHeading>

            {loading ? (
                <div className="space-y-6">
                    {[0, 1, 2].map((i) => (
                        <div
                            key={i}
                            className="bg-card border-border h-40 animate-pulse rounded-xl border"
                        />
                    ))}
                </div>
            ) : failed || !catalog ? (
                <div className="bg-card border-border rounded-xl border p-8 text-center">
                    <p className="text-muted-foreground text-sm">
                        Не вдалося завантажити тарифи. Спробуйте перезавантажити
                        сторінку
                    </p>
                </div>
            ) : (
                <>
                    {BILLING_DEMO_MODE && <DemoBanner />}

                    {profile && (
                        <StatusCard
                            profile={profile}
                            onResume={handleResume}
                            resuming={resuming}
                            onCancel={openCancel}
                        />
                    )}

                    {catalog.brand.enabled && (
                        <BrandUniverseCard
                            catalog={catalog}
                            profile={profile}
                            businesses={businesses}
                            onChanged={reloadProfile}
                        />
                    )}

                    <DocumentsUniverseCard catalog={catalog} profile={profile} />

                    <RecentPayments reloadKey={String(reloadKey)} />
                </>
            )}
        </UiPageContainer>
    );
}

function StatusCard({
    profile,
    onResume,
    resuming,
    onCancel,
}: {
    profile: BillingProfileView;
    onResume: () => void;
    resuming: boolean;
    onCancel: (periodEnd: string | null) => void;
}) {
    const periodEnd = profile.currentPeriodEnd
        ? formatLocalDate(profile.currentPeriodEnd)
        : null;
    const pastDue = profile.status === SUBSCRIPTION_STATUS.PAST_DUE;
    const active = profile.status === SUBSCRIPTION_STATUS.ACTIVE;
    const nextCharge =
        profile.nextChargeAmount > 0
            ? formatPrice(profile.nextChargeAmount, profile.currency ?? 'UAH')
            : null;

    if (pastDue) {
        return (
            <section className="border-warning/40 bg-warning/10 rounded-xl border p-6 md:p-8">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="text-warning mt-0.5 size-5 shrink-0" />
                    <div className="space-y-3">
                        <div>
                            <h2 className="text-foreground text-lg font-semibold">
                                Списання не пройшло
                            </h2>
                            <p className="text-muted-foreground mt-1 text-sm">
                                Доступ ще діє. Оплатіть, щоб не втратити бренд
                                своїх отримувачів.
                            </p>
                        </div>
                        <UiButton
                            variant="filled"
                            size="md"
                            onClick={onResume}
                            loading={resuming}
                            className="w-full sm:w-auto"
                        >
                            Оплатити зараз
                        </UiButton>
                    </div>
                </div>
            </section>
        );
    }

    if (!active) return null;

    return (
        <section className="bg-card rounded-xl border p-6 md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    {profile.cancelAtPeriodEnd ? (
                        <p className="text-muted-foreground text-sm">
                            Підписку скасовано.{' '}
                            {periodEnd
                                ? `Доступ діє до ${periodEnd}`
                                : 'Доступ діє до кінця періоду'}
                        </p>
                    ) : (
                        <p className="text-muted-foreground text-sm">
                            {nextCharge && periodEnd
                                ? `Наступне списання ${periodEnd}: ${nextCharge}`
                                : 'Підписка активна'}
                        </p>
                    )}
                    {profile.cardMask && (
                        <p className="text-muted-foreground mt-1 text-xs">
                            Картка {profile.cardMask}
                        </p>
                    )}
                </div>
                {!profile.cancelAtPeriodEnd && (
                    <UiButton
                        variant="text"
                        size="sm"
                        onClick={() =>
                            onCancel(
                                profile.currentPeriodEnd
                                    ? String(profile.currentPeriodEnd)
                                    : null
                            )
                        }
                    >
                        Скасувати підписку
                    </UiButton>
                )}
            </div>
        </section>
    );
}
