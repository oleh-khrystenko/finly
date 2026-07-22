'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Minus, Plus, X, Sparkles } from 'lucide-react';
import {
    BILLING_UNIVERSE,
    SUBSCRIPTION_STATUS,
    formatPrice,
    type BillingCatalog,
    type BillingProfileView,
    type BusinessWithCounts,
} from '@finly/types';
import {
    attachBusiness,
    calculatePrice,
    changeCapacity,
    startCheckout,
} from '@/shared/api/payments';
import { extractApiErrorCode, getApiMessage } from '@/shared/api';
import { pluralizeUa } from '@/shared/lib';
import UiButton from '@/shared/ui/UiButton';
import { useBrandPickerDialogStore } from './brandPickerDialogStore';
import { useBrandProrationConfirmStore } from './brandProrationConfirmStore';
import { useBrandDetachConfirmStore } from './brandDetachConfirmStore';
import { useBrandDecreaseConfirmStore } from './brandDecreaseConfirmStore';

interface Props {
    catalog: BillingCatalog;
    profile: BillingProfileView | null;
    businesses: BusinessWithCounts[];
    onChanged: () => void;
}

/**
 * Sprint 27 — склад всесвіту «Бренд»: логотип + власне посилання per-business.
 * Ціна поштучна (без пакетів). Керування: прикріплення/відкріплення отримувачів
 * у межах ємності (безкоштовно), додавання нового слота з негайною пропорційною
 * доплатою, перша купівля через хостований checkout. Усі overlay-и — окремі
 * компоненти зі своїми store, змонтовані через `app/overlays.tsx` (overlays.md);
 * картка лише викликає `open()` з payload-ом.
 */
export default function BrandUniverseCard({
    catalog,
    profile,
    businesses,
    onChanged,
}: Props) {
    const [busy, setBusy] = useState(false);
    const openPicker = useBrandPickerDialogStore((s) => s.open);
    const openProration = useBrandProrationConfirmStore((s) => s.open);
    const openDetach = useBrandDetachConfirmStore((s) => s.open);
    const openDecrease = useBrandDecreaseConfirmStore((s) => s.open);

    // Живий доступ = ACTIVE або PAST_DUE (грейс). Профіль з покинутим checkout-ом
    // (INCOMPLETE) чи згаслий (CANCELED/UNPAID) тримає бажані/старі склади у БД,
    // але нічого не оплачено: показуємо його як «без Бренду» з CTA першої
    // купівлі, інакше користувач застряг би без жодного шляху оплатити.
    const entitled =
        profile != null &&
        (profile.status === SUBSCRIPTION_STATUS.ACTIVE ||
            profile.status === SUBSCRIPTION_STATUS.PAST_DUE);
    // Скасований-до-кінця-періоду профіль: доступ ще живий, але токен картки
    // стерто, тож платні дії (новий слот, підключення) API відхиляє
    // (BILLING_CANCEL_PENDING), а перша купівля заблокована до згасання профілю
    // (BILLING_ALREADY_ACTIVE). Показуємо лише безкоштовні дії: прикріплення у
    // вільний слот і відкріплення.
    const cancelPending = entitled && profile.cancelAtPeriodEnd;
    // Прострочка: доступ ще діє (грейс), але платні дії (новий слот) API
    // відхиляє BILLING_PAST_DUE — період минув, пропорційна доплата була б
    // нульовою і розширення діставалось би безкоштовно. Безкоштовні дії
    // (прикріплення у вільний слот, відкріплення, зменшення) лишаються.
    const pastDue = entitled && profile.status === SUBSCRIPTION_STATUS.PAST_DUE;
    const capacity = entitled ? profile.brand.capacity : 0;
    const attachedIds = entitled ? profile.brand.attachedBusinessIds : [];
    // Заплановане зменшення (діє з наступного списання, скасовне до межі циклу).
    const scheduledCapacity = entitled ? profile.brand.pendingCapacity : null;
    const attached = useMemo(
        () =>
            attachedIds
                .map((id) => businesses.find((b) => b.id === id))
                .filter((b): b is BusinessWithCounts => b != null),
        [attachedIds, businesses]
    );
    const attachable = useMemo(
        () => businesses.filter((b) => !attachedIds.includes(b.id)),
        [businesses, attachedIds]
    );
    const freeSlots = Math.max(0, capacity - attachedIds.length);
    const monthly = capacity * catalog.brand.pricePerBusiness;
    const perBusiness = formatPrice(
        catalog.brand.pricePerBusiness,
        catalog.currency
    );

    const showError = (err: unknown) =>
        toast.error(getApiMessage(extractApiErrorCode(err), 'payments'));

    // Перша купівля: хостований checkout з прикріпленням обраного отримувача.
    const handleFirstCheckout = async (businessId: string) => {
        setBusy(true);
        try {
            const { checkoutUrl } = await startCheckout({
                universe: BILLING_UNIVERSE.BRAND,
                capacity: 1,
                attachBusinessId: businessId,
                returnPath: '/billing',
            });
            window.location.href = checkoutUrl;
        } catch (err) {
            showError(err);
            setBusy(false);
        }
    };

    // Прикріплення у вільний слот — миттєве й безкоштовне.
    const handleAttachFree = async (businessId: string) => {
        setBusy(true);
        try {
            await attachBusiness({
                universe: BILLING_UNIVERSE.BRAND,
                businessId,
            });
            toast.success('Отримувача прикріплено до Бренду');
            onChanged();
        } catch (err) {
            showError(err);
        } finally {
            setBusy(false);
        }
    };

    // Немає вільного слота — рахуємо пропорційну доплату і відкриваємо
    // підтвердження (окремий overlay сам виконує списання).
    const handleAddPaid = async (businessId: string) => {
        setBusy(true);
        try {
            const calc = await calculatePrice({
                universe: BILLING_UNIVERSE.BRAND,
                capacity: capacity + 1,
            });
            openProration({
                businessId,
                newCapacity: capacity + 1,
                immediateCharge: calc.immediateCharge,
                newMonthlyAmount: calc.newMonthlyAmount,
                currency: catalog.currency,
                onDone: onChanged,
            });
        } catch (err) {
            showError(err);
        } finally {
            setBusy(false);
        }
    };

    // Скасувати заплановане зменшення: виклик з поточною ємністю знімає його.
    const handleCancelDecrease = async () => {
        setBusy(true);
        try {
            await changeCapacity({
                universe: BILLING_UNIVERSE.BRAND,
                capacity,
            });
            toast.success('Зменшення скасовано');
            onChanged();
        } catch (err) {
            showError(err);
        } finally {
            setBusy(false);
        }
    };

    const handlePick = (businessId: string) => {
        // Вільний слот — миттєво і безкоштовно. Живий профіль без вільного слота
        // (у т.ч. лише з документним пакетом, Бренд-ємність 0) — новий слот
        // доплатою за токеном: startCheckout на entitled-профілі детерміновано
        // відхиляється BILLING_ALREADY_ACTIVE. Без живого профілю — перша
        // купівля через хостований checkout.
        if (freeSlots > 0) return handleAttachFree(businessId);
        // Скасований профіль: платний шлях зарубає API (BILLING_CANCEL_PENDING),
        // тож не ведемо у діалог доплати. Кнопки і так сховані; це страховка
        // від застарілого стану (слот зайняли в іншій вкладці).
        if (cancelPending) {
            toast.error(
                'Підписку скасовано. Додати слот можна буде після завершення оплаченого періоду'
            );
            return;
        }
        // У прострочці платний шлях зарубає API (BILLING_PAST_DUE), тож не
        // ведемо у діалог доплати: спершу оплата поточного періоду.
        if (pastDue) {
            toast.error(
                'Списання не пройшло. Оплатіть поточний період, після цього зможете додати слот'
            );
            return;
        }
        if (entitled) return handleAddPaid(businessId);
        return handleFirstCheckout(businessId);
    };

    const handleOpenPicker = () =>
        openPicker({
            businesses: attachable.map((b) => ({ id: b.id, name: b.name })),
            onPick: handlePick,
        });

    return (
        <section className="bg-card rounded-xl border p-6 md:p-8">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
                        <Sparkles className="size-5" />
                    </span>
                    <div>
                        <h2 className="text-foreground text-xl font-semibold tracking-tight">
                            Бренд
                        </h2>
                        <p className="text-muted-foreground text-sm">
                            Логотип і власне посилання · {perBusiness} за
                            отримувача на місяць
                        </p>
                    </div>
                </div>
                {capacity > 0 && (
                    <div className="text-right">
                        <p className="text-foreground text-sm font-semibold">
                            {formatPrice(monthly, catalog.currency)}
                        </p>
                        <p className="text-muted-foreground text-xs">
                            на місяць
                        </p>
                    </div>
                )}
            </div>

            {capacity === 0 ? (
                <div className="mt-6 space-y-4">
                    {cancelPending ? (
                        // Скасований профіль без Бренд-слотів (лише документи):
                        // підключення потребує доплати за токеном, якого вже
                        // немає. Нова купівля стане доступною після згасання
                        // профілю на межі періоду.
                        <p className="text-muted-foreground text-sm">
                            Підписку скасовано. Підключити Бренд можна буде
                            після завершення оплаченого періоду
                        </p>
                    ) : (
                        <>
                            <p className="text-muted-foreground text-sm">
                                Оберіть отримувача, якому ввімкнути власний
                                логотип і коротке посилання. Далі зможете
                                додавати ще по одному.
                            </p>
                            <UiButton
                                variant="filled"
                                size="md"
                                IconLeft={<Plus className="size-4" />}
                                onClick={handleOpenPicker}
                                disabled={busy || attachable.length === 0}
                                className="w-full sm:w-auto"
                            >
                                Підключити Бренд
                            </UiButton>
                            {attachable.length === 0 && (
                                <p className="text-muted-foreground text-sm">
                                    Спершу створіть отримувача
                                </p>
                            )}
                        </>
                    )}
                </div>
            ) : (
                <div className="mt-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-muted-foreground text-sm">
                            Оплачено слотів: {capacity}
                            {freeSlots > 0 && ` · вільних: ${freeSlots}`}
                        </p>
                        <div className="flex items-center gap-2">
                            {!cancelPending &&
                                freeSlots > 0 &&
                                scheduledCapacity === null && (
                                    <UiButton
                                        variant="outline"
                                        size="sm"
                                        IconLeft={<Minus className="size-4" />}
                                        onClick={() =>
                                            openDecrease({
                                                newCapacity: capacity - 1,
                                                keepBusinessIds: attachedIds,
                                                newMonthlyAmount:
                                                    (capacity - 1) *
                                                    catalog.brand
                                                        .pricePerBusiness,
                                                currency: catalog.currency,
                                                onDone: onChanged,
                                            })
                                        }
                                        disabled={busy}
                                    >
                                        Прибрати слот
                                    </UiButton>
                                )}
                            {/* На скасованому профілі новий слот купити не можна
                                (токен стерто), тож кнопка лишається лише поки є
                                вільні слоти для безкоштовного прикріплення. */}
                            {(!cancelPending || freeSlots > 0) && (
                                <UiButton
                                    variant="outline"
                                    size="sm"
                                    IconLeft={<Plus className="size-4" />}
                                    onClick={handleOpenPicker}
                                    disabled={busy || attachable.length === 0}
                                >
                                    Додати отримувача
                                </UiButton>
                            )}
                        </div>
                    </div>

                    {scheduledCapacity !== null && (
                        <div className="border-border bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                            <p className="text-muted-foreground text-sm">
                                {scheduledCapacity === 0
                                    ? 'З наступного списання Бренд буде вимкнено'
                                    : `З наступного списання лишиться ${pluralizeUa(scheduledCapacity, 'слот', 'слоти', 'слотів')}`}
                            </p>
                            {/* На скасованому профілі відкликання зменшення —
                                білінг-мутація без токена, API її відхиляє; та й
                                профіль однаково гасне на межі періоду. */}
                            {!cancelPending && (
                                <UiButton
                                    variant="outline"
                                    size="sm"
                                    onClick={handleCancelDecrease}
                                    disabled={busy}
                                >
                                    Скасувати зменшення
                                </UiButton>
                            )}
                        </div>
                    )}

                    {attached.length === 0 ? (
                        <p className="border-border text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
                            Слоти оплачені, але жодного отримувача не
                            прикріплено. Прикріпіть отримувача, щоб увімкнути
                            йому бренд.
                        </p>
                    ) : (
                        <ul className="divide-border divide-y">
                            {attached.map((b) => (
                                <li
                                    key={b.id}
                                    className="flex items-center justify-between gap-3 py-3"
                                >
                                    <span className="text-foreground min-w-0 truncate text-sm font-medium">
                                        {b.name}
                                    </span>
                                    <UiButton
                                        variant="text"
                                        size="sm"
                                        IconLeft={<X className="size-4" />}
                                        onClick={() =>
                                            openDetach({
                                                businessId: b.id,
                                                businessName: b.name,
                                                onDone: onChanged,
                                            })
                                        }
                                        disabled={busy}
                                        aria-label={`Відкріпити ${b.name}`}
                                    >
                                        Відкріпити
                                    </UiButton>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </section>
    );
}
