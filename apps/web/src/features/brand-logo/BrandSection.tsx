'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { Business, BusinessBrand } from '@finly/types';

import UiBrandLogo from '@/shared/ui/UiBrandLogo';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import {
    deleteBrandLogo,
    extractApiErrorCode,
    getApiMessage,
} from '@/shared/api';

import { useBrandLogoDialogStore } from './brandLogoDialogStore';

interface Props {
    business: Business;
    /** Платний рівень (≥ brand). На free Save веде на пейвол. */
    isPaid: boolean;
    onSubscribe: () => void;
    subscribePriceLabel: string;
    /** Оновити локальний стан сторінки після зміни бренду (без re-fetch). */
    onApplied: (brand: BusinessBrand | null) => void;
}

/**
 * Sprint 21 — секція кастомного бренду отримувача. Присутня на трьох рівнях
 * матрьошки (отримувач / реквізити / рахунок), редагує ЄДИНИЙ бренд бізнесу —
 * копія це проговорює. Три стани: активний логотип, логотип в очікуванні оплати,
 * дефолтний Finly. Кнопка завантаження видима всім рівням доступу; пейвол — на
 * Save усередині модалки (дзеркало slug-upsell).
 */
export default function BrandSection({
    business,
    isPaid,
    onSubscribe,
    subscribePriceLabel,
    onApplied,
}: Props) {
    const openDialog = useBrandLogoDialogStore((s) => s.open);
    const [deleting, setDeleting] = useState(false);

    const active = business.brand?.active ?? null;
    const pending = business.brand?.pending ?? null;
    const shown = active ?? pending;
    // Підпис тепер всередині плашки (поряд з лого, як на pay-сторінках), тож
    // текстова колонка лишається лише для статусу «очікує оплати». В активному
    // стані її не рендеримо, щоб порожня обгортка не зміщувала кнопки.
    const hasInfo = !active;

    const openUpload = () => {
        openDialog({
            businessSlug: business.slug,
            isPaid,
            subscribePriceLabel,
            onSubscribe,
            onApplied,
        });
    };

    const handleDelete = async () => {
        if (deleting) return;
        setDeleting(true);
        try {
            await deleteBrandLogo(business.slug);
            onApplied(null);
            toast.success('Бренд видалено');
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'storage'));
        } finally {
            setDeleting(false);
        }
    };

    const actions = (
        <div className="flex flex-wrap gap-3">
            {!active && pending && (
                <UiButton
                    type="button"
                    variant="filled"
                    size="md"
                    onClick={onSubscribe}
                >
                    {subscribePriceLabel}
                </UiButton>
            )}
            <UiButton
                type="button"
                variant={shown ? 'outline' : 'filled'}
                size="md"
                onClick={openUpload}
            >
                {shown ? 'Замінити логотип' : 'Завантажити логотип'}
            </UiButton>
            {shown && (
                <UiButton
                    type="button"
                    variant="destructive-outline"
                    size="md"
                    onClick={() => void handleDelete()}
                    loading={deleting}
                >
                    Видалити
                </UiButton>
            )}
        </div>
    );

    return (
        <UiSectionCard title="Логотип бренду">
            <p className="text-muted-foreground mt-2 text-sm">
                Власний логотип замінює Finly в обох QR-кодах і на платіжних
                сторінках. Бренд єдиний для всіх реквізитів і рахунків цього
                отримувача.
            </p>

            <div className="mt-4 space-y-4">
                {shown ? (
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                        <div className="self-center sm:self-auto">
                            <UiBrandLogo
                                src={shown.logoUrl}
                                alt="Логотип бренду"
                                displayName={shown.displayName}
                            />
                        </div>
                        <div className="flex min-w-0 flex-col gap-3">
                            {hasInfo && (
                                <div className="space-y-1">
                                    <p className="text-foreground text-base font-medium">
                                        Очікує оплати
                                    </p>
                                    {pending && (
                                        <p className="text-muted-foreground text-sm">
                                            Логотип застосується автоматично
                                            після оформлення тарифу «Бренд».
                                        </p>
                                    )}
                                </div>
                            )}
                            {actions}
                        </div>
                    </div>
                ) : (
                    <>
                        <p className="text-muted-foreground text-sm">
                            Зараз показується стандартний брендинг Finly.
                        </p>
                        {actions}
                    </>
                )}
            </div>
        </UiSectionCard>
    );
}
