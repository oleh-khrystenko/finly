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
import { BILLING_DEMO_MODE } from '@/shared/config';
import {
    getBillingProfile,
    getCatalog,
    reactivateSubscription,
    renewSubscription,
    resumeSubscription,
    startCardVerification,
} from '@/shared/api/payments';
import {
    extractApiErrorCode,
    getApiMessage,
    listBusinesses,
} from '@/shared/api';
import { composeClasses, formatLocalDate } from '@/shared/lib';
import {
    BrandUniverseCard,
    DemoBanner,
    DocumentsUniverseCard,
    formatCardLabel,
    RecentPayments,
    useCancelSubscriptionDialogStore,
    useCardChangeConfirmStore,
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
    const [renewing, setRenewing] = useState(false);
    const [linkingCard, setLinkingCard] = useState(false);
    const [reactivating, setReactivating] = useState(false);

    const openCancel = useCancelSubscriptionDialogStore((s) => s.open);
    const openCardChangeConfirm = useCardChangeConfirmStore((s) => s.open);

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

    // Відкликання скасування: грошей не рухає, тож ніякого переходу на банк —
    // просто оновлюємо стан підписки на місці.
    const handleRenew = async () => {
        setRenewing(true);
        try {
            await renewSubscription();
            reloadProfile();
            toast.success('Підписку відновлено');
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'payments'));
        } finally {
            setRenewing(false);
        }
    };

    // Прив'язка або заміна картки: сторінка банку з рахунком на нуль. Гроші не
    // рухаються, тож жодного підтвердження суми тут немає.
    const handleCardVerification = async (renewAfterSave: boolean) => {
        // У прострочці заміна картки тягне за собою негайне списання боргу,
        // тож суму називаємо ДО переходу на сторінку банку.
        const debt =
            profile?.status === SUBSCRIPTION_STATUS.PAST_DUE
                ? profile.nextChargeAmount
                : 0;
        if (debt > 0) {
            openCardChangeConfirm({
                chargeAfterSave: debt,
                currency: profile?.currency ?? 'UAH',
                onConfirm: () => void startCardLinking(renewAfterSave),
            });
            return;
        }
        await startCardLinking(renewAfterSave);
    };

    const startCardLinking = async (renewAfterSave: boolean) => {
        setLinkingCard(true);
        try {
            const { checkoutUrl } = await startCardVerification({
                renewAfterSave,
                returnPath: '/billing',
            });
            window.location.href = checkoutUrl;
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'payments'));
            setLinkingCard(false);
        }
    };

    // Повернення після вимкнення доступу: списуємо збережену картку на місці,
    // без переходу на сторінку банку.
    const handleReactivate = async () => {
        setReactivating(true);
        try {
            const { scheduled } = await reactivateSubscription();
            reloadProfile();
            toast.success(
                scheduled
                    ? 'Оплату прийнято, доступ повернеться за кілька хвилин'
                    : 'Оплату проведено, доступ відновлено'
            );
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'payments'));
        } finally {
            setReactivating(false);
        }
    };

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
        <UiPageContainer className="space-y-6">
            <UiPageHeading>Тарифи</UiPageHeading>

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
                <div className="bg-card border-border rounded-xl border p-4 text-center md:p-6">
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
                            onRenew={handleRenew}
                            renewing={renewing}
                            onLinkCard={handleCardVerification}
                            linkingCard={linkingCard}
                            onReactivate={handleReactivate}
                            reactivating={reactivating}
                            onCancel={openCancel}
                        />
                    )}

                    {/* Два всесвіти поруч на lg+ — заповнюють робочу ширину
                        замість стосу вузьких карток. Нижче lg — стос. Коли
                        «Бренд» вимкнено, колонка одна — інакше самотня картка
                        «Документи» займала б пів ряду з порожнім сусідом. */}
                    <div
                        className={composeClasses(
                            'grid items-start gap-6',
                            catalog.brand.enabled && 'lg:grid-cols-2'
                        )}
                    >
                        {catalog.brand.enabled && (
                            <BrandUniverseCard
                                catalog={catalog}
                                profile={profile}
                                businesses={businesses}
                                onChanged={reloadProfile}
                            />
                        )}

                        <DocumentsUniverseCard
                            catalog={catalog}
                            profile={profile}
                        />
                    </div>

                    <RecentPayments reloadKey={String(reloadKey)} />
                </>
            )}
        </UiPageContainer>
    );
}

/**
 * Прив'язаний спосіб оплати. Показується в КОЖНОМУ стані підписки, не лише в
 * активному: коли списання не пройшло, питання «з чого саме намагались зняти»
 * і є головним, а на скасованій підписці з цієї ж картки піде поновлення.
 */
function PaymentMethodLine({ label }: { label: string }) {
    return (
        <p className="text-muted-foreground mt-1 text-xs">
            Спосіб оплати: {label}
        </p>
    );
}

function StatusCard({
    profile,
    onResume,
    resuming,
    onRenew,
    renewing,
    onLinkCard,
    linkingCard,
    onReactivate,
    reactivating,
    onCancel,
}: {
    profile: BillingProfileView;
    onResume: () => void;
    resuming: boolean;
    onRenew: () => void;
    renewing: boolean;
    onLinkCard: (renewAfterSave: boolean) => void;
    linkingCard: boolean;
    onReactivate: () => void;
    reactivating: boolean;
    onCancel: (periodEnd: string | null) => void;
}) {
    const periodEnd = profile.currentPeriodEnd
        ? formatLocalDate(profile.currentPeriodEnd)
        : null;
    const pastDue = profile.status === SUBSCRIPTION_STATUS.PAST_DUE;
    const active = profile.status === SUBSCRIPTION_STATUS.ACTIVE;
    // Не `status === UNPAID`: покинута нова купівля змінює статус на
    // INCOMPLETE, а стан «доступ вимкнено несплатою» лишається тим самим —
    // сервер його і віддає окремим прапорцем.
    const disabled = profile.accessDisabledByNonPayment;
    const nextCharge =
        profile.nextChargeAmount > 0
            ? formatPrice(profile.nextChargeAmount, profile.currency ?? 'UAH')
            : null;
    const cardLabel = formatCardLabel(profile);

    if (pastDue) {
        return (
            <section className="border-warning/40 bg-warning/10 rounded-xl border p-4 md:p-6">
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
                            {cardLabel && (
                                <PaymentMethodLine label={cardLabel} />
                            )}
                        </div>
                        <div className="flex flex-wrap gap-3">
                            <UiButton
                                variant="filled"
                                size="md"
                                onClick={onResume}
                                loading={resuming}
                                className="w-full sm:w-auto"
                            >
                                Оплатити зараз
                            </UiButton>
                            {/* Найчастіша причина, чому списання не проходить,
                                це сама картка: спливлий термін, блокування,
                                перевипуск. Тому заміна стоїть поруч з оплатою,
                                а не ховається на активному стані. */}
                            <UiButton
                                variant="outline"
                                size="md"
                                onClick={() => onLinkCard(false)}
                                loading={linkingCard}
                                className="w-full sm:w-auto"
                            >
                                Замінити картку
                            </UiButton>
                        </div>
                    </div>
                </div>
            </section>
        );
    }

    // Доступ вимкнено несплатою, але картка ще зберігається: повернення в один
    // крок, без сторінки банку. Новий місяць рахується від дня оплати, дні без
    // доступу не доплачуються — про це кажемо прямо.
    if (disabled && profile.hasSavedCard) {
        return (
            <section className="border-warning/40 bg-warning/10 rounded-xl border p-4 md:p-6">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="text-warning mt-0.5 size-5 shrink-0" />
                    <div className="space-y-3">
                        <div>
                            <h2 className="text-foreground text-lg font-semibold">
                                Доступ вимкнено
                            </h2>
                            <p className="text-muted-foreground mt-1 text-sm">
                                Списання так і не пройшло. Оплатіть, щоб
                                повернути бренд своїх отримувачів
                                {nextCharge ? `: ${nextCharge}` : ''}. Місяць
                                почнеться від сьогодні
                            </p>
                            {cardLabel && (
                                <PaymentMethodLine label={cardLabel} />
                            )}
                        </div>
                        <div className="flex flex-wrap gap-3">
                            <UiButton
                                variant="filled"
                                size="md"
                                onClick={onReactivate}
                                loading={reactivating}
                                className="w-full sm:w-auto"
                            >
                                Оплатити збереженою карткою
                            </UiButton>
                            <UiButton
                                variant="outline"
                                size="md"
                                onClick={() => onLinkCard(false)}
                                loading={linkingCard}
                                className="w-full sm:w-auto"
                            >
                                Замінити картку
                            </UiButton>
                        </div>
                    </div>
                </div>
            </section>
        );
    }

    if (!active) {
        if (!cardLabel) return null;
        return (
            <section className="bg-card rounded-xl border p-4 md:p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <PaymentMethodLine label={cardLabel} />
                    {profile.hasSavedCard && (
                        <UiButton
                            variant="outline"
                            size="sm"
                            onClick={() => onLinkCard(false)}
                            loading={linkingCard}
                        >
                            Замінити картку
                        </UiButton>
                    )}
                </div>
            </section>
        );
    }

    return (
        <section className="bg-card rounded-xl border p-4 md:p-6">
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
                    {cardLabel && <PaymentMethodLine label={cardLabel} />}
                    {/* Скасована підписка без збереженої картки: відновлення
                        поновило б списання, якому нема з чого списувати, тож
                        сервер його не пропустить. Кнопка веде на прив'язку, а
                        підписка відновиться сама після збереження картки. */}
                    {profile.cancelAtPeriodEnd && !profile.hasSavedCard && (
                        <p className="text-muted-foreground mt-2 text-xs">
                            Збереженої картки немає: щоб відновити підписку,
                            додайте картку. Гроші зараз не спишуться
                        </p>
                    )}
                </div>
                <div className="flex flex-wrap gap-2">
                    {profile.cancelAtPeriodEnd ? (
                        profile.hasSavedCard ? (
                            <UiButton
                                variant="outline"
                                size="sm"
                                onClick={onRenew}
                                loading={renewing}
                            >
                                Відновити підписку
                            </UiButton>
                        ) : (
                            <UiButton
                                variant="filled"
                                size="sm"
                                onClick={() => onLinkCard(true)}
                                loading={linkingCard}
                            >
                                Додати картку і відновити
                            </UiButton>
                        )
                    ) : (
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
                    {profile.hasSavedCard && (
                        <UiButton
                            variant="text"
                            size="sm"
                            onClick={() => onLinkCard(false)}
                            loading={linkingCard}
                        >
                            Замінити картку
                        </UiButton>
                    )}
                </div>
            </div>
        </section>
    );
}
