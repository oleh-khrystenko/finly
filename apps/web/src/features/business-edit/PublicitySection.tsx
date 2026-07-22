'use client';

import { useState } from 'react';
import type { Business } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSwitch from '@/shared/ui/UiSwitch';
import UiUpsellNote from '@/shared/ui/UiUpsellNote';

interface Props {
    business: Business;
    /** Подати запит на публічність. Кидає при помилці (сторінка вже показала toast). */
    onRequest: () => Promise<void>;
    /** Відкликати заявку, що ще на розгляді (місця в каталозі ще не було). */
    onCancelRequest: () => Promise<void>;
    /** Вийти з каталогу вже схваленому отримувачу. */
    onLeaveCatalog: () => Promise<void>;
    /** Тогл видимості отримувача у каталозі (доступний лише після схвалення). */
    onToggleVisibility: (visible: boolean) => Promise<void>;
}

/**
 * Sprint 29 — блок «Каталог Finly» на сторінці отримувача. Шлях у публічний
 * каталог: красиве посилання (тариф «Бренд») → запит на публічність → схвалення
 * адміном → увімкнення видимості. Кожен стан показує рівно одну наступну дію.
 *
 * Видимістю окремих реквізитів керують на сторінці кожного рахунку (гранулярність
 * per-рівень), тому тут лише отримувач-рівень плюс підказка.
 */
export default function PublicitySection({
    business,
    onRequest,
    onCancelRequest,
    onLeaveCatalog,
    onToggleVisibility,
}: Props) {
    const [busy, setBusy] = useState(false);

    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        try {
            await action();
        } catch {
            // Сторінка-власник показала toast і кинула далі.
        } finally {
            setBusy(false);
        }
    };

    return (
        <UiSectionCard title="Каталог Finly">
            <p className="text-muted-foreground mt-2 text-sm">
                Каталог це публічна вітрина перевірених отримувачів. Потрапити
                туди можна лише з красивим посиланням і після схвалення.
            </p>

            <div className="mt-4">{renderBody()}</div>
        </UiSectionCard>
    );

    function renderBody() {
        // Гейт красивого посилання перевіряється ПІСЛЯ стану заявки. Красиве
        // посилання можна втратити вже після подання (скидання slug вручну або
        // згасання «Бренду» через slug-rent), і гейт першим рядком ховав би тоді
        // всю секцію: заявка лишалася б в адмінській черзі, а користувач не мав
        // би жодної дії, щоб її відкликати.
        if (business.publicityStatus === 'pending') {
            return (
                <div className="flex flex-col gap-3">
                    <p className="text-foreground text-base">
                        Заявку подано. Вона на розгляді, ми повідомимо про
                        рішення.
                    </p>
                    <div>
                        <UiButton
                            type="button"
                            variant="outline"
                            size="md"
                            disabled={busy}
                            onClick={() => void run(onCancelRequest)}
                        >
                            Скасувати заявку
                        </UiButton>
                    </div>
                </div>
            );
        }

        if (business.publicityStatus === 'approved') {
            return (
                <div className="flex flex-col gap-4">
                    {!business.slugCustomized && (
                        // Схвалення лишилось, а красиве посилання злетіло: у
                        // каталог запис не потрапляє (гейт на читанні), тож
                        // пояснюємо це замість мовчазної порожньої вітрини.
                        <UiUpsellNote
                            message="Отримувача схвалено, але зараз він не показується в каталозі: у нього немає красивого посилання. Воно доступне на тарифі «Бренд»."
                            ctaLabel="Обрати тариф"
                        />
                    )}
                    <label
                        htmlFor="catalog-toggle"
                        className="flex cursor-pointer flex-col gap-1"
                    >
                        <span className="flex items-center justify-between gap-3">
                            <span className="text-foreground text-lg font-medium">
                                {business.catalogVisible
                                    ? 'Отримувач показується в каталозі'
                                    : 'Отримувач прихований з каталогу'}
                            </span>
                            <UiSwitch
                                id="catalog-toggle"
                                className="shrink-0"
                                checked={business.catalogVisible}
                                disabled={busy}
                                onChange={(next) =>
                                    void run(() => onToggleVisibility(next))
                                }
                            />
                        </span>
                        <span className="text-muted-foreground text-sm">
                            Видимістю окремих реквізитів керуйте на сторінці
                            кожного рахунку.
                        </span>
                    </label>
                    <div>
                        <UiButton
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void run(onLeaveCatalog)}
                        >
                            Вийти з каталогу
                        </UiButton>
                    </div>
                </div>
            );
        }

        // status 'none' або 'rejected' — тут гейт доречний: подати заявку без
        // красивого посилання не можна (сервер відповість тим самим).
        if (!business.slugCustomized) {
            return (
                <UiUpsellNote
                    message="Щоб подати заявку в каталог, спочатку дайте отримувачу красиве посилання. Воно доступне на тарифі «Бренд»."
                    ctaLabel="Обрати тариф"
                />
            );
        }

        return (
            <div className="flex flex-col gap-3">
                {business.publicityStatus === 'rejected' &&
                    business.publicityRejectionReason && (
                        <div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
                            <p className="text-foreground text-sm font-medium">
                                Попередню заявку відхилено
                            </p>
                            <p className="text-muted-foreground mt-1 text-sm">
                                {business.publicityRejectionReason}
                            </p>
                        </div>
                    )}
                <p className="text-muted-foreground text-sm">
                    Подайте заявку на розгляд. Після схвалення ви самі оберете,
                    що показувати в каталозі.
                </p>
                <div>
                    <UiButton
                        type="button"
                        variant="filled"
                        size="md"
                        disabled={busy}
                        onClick={() => void run(onRequest)}
                    >
                        {business.publicityStatus === 'rejected'
                            ? 'Подати заявку знову'
                            : 'Подати заявку в каталог'}
                    </UiButton>
                </div>
            </div>
        );
    }
}
