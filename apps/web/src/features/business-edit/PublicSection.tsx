'use client';

import {
    buildQrDownloadFilename,
    businessSlugSchema,
    type Business,
    type SlugAvailabilityStatus,
    type SlugReservationView,
    type UpdateBusinessRequest,
} from '@finly/types';
import UiQrPanel from '@/shared/ui/UiQrPanel';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSlugEditor from '@/shared/ui/UiSlugEditor';
import UiSwitch from '@/shared/ui/UiSwitch';
import UiUpsellNote from '@/shared/ui/UiUpsellNote';
import { mapValidationCode, qrBrandVersion } from '@/shared/lib';
import { useState } from 'react';
import { toast } from 'sonner';
import { useResetBusinessSlugConfirmStore } from './resetBusinessSlugConfirmStore';

interface Props {
    business: Business;
    /** Public payment-page origin (NEXT_PUBLIC_PAY_PUBLIC_URL чи аналог). */
    payPublicOrigin: string;
    apiBase?: string;
    /** Платний рівень (brand+): Save пише slug одразу, інакше — бронь + апсел. */
    isPaid: boolean;
    onSave: (patch: UpdateBusinessRequest) => Promise<void>;
    /** Скидання slug-у на свіже випадкове посилання (через confirm-dialog). */
    onResetSlug: () => Promise<void>;
    /** Sprint 20 — live-доступність бажаного імені. */
    checkSlugAvailability: (slug: string) => Promise<SlugAvailabilityStatus>;
    /** Sprint 20 — холд бажаного імені (free-flow на Save). */
    reserveSlug: (slug: string) => Promise<SlugReservationView>;
    /** Sprint 20 — primary CTA апселу: підписка з поверненням на цю сторінку. */
    onSubscribe: () => void;
    subscribePriceLabel: string;
    /** Активна бронь цієї сутності (показати апсел + відлік одразу). */
    initialReservation: SlugReservationView | null;
    /** Фолбек «оберіть інше»: відкрити поле редагування на mount. */
    autoStartSlugEdit: boolean;
}

/**
 * Sprint 14: slug + public URL — один концепт (адреса публічної сторінки).
 * Sprint 20 інвертує гейтинг: поле і кнопка редагування видимі всім рівням
 * (`UiSlugEditor`), бар'єр спрацьовує на Save (free → бронь + inline-апсел).
 *
 * QR-код тут — друге кодування тієї самої адреси (URL для людини, QR для камери),
 * тому живе в одній картці. На бізнес-рівні можливий лише тип-2 (URL на вітрину).
 *
 * Sprint 19: заблокований реконсиляцією отримувач (`accessBlockedAt`) рендерить
 * стан «доступ призупинено» — публічні ендпоінти для нього віддають 404.
 */
export default function PublicSection({
    business,
    payPublicOrigin,
    apiBase = '/api',
    isPaid,
    onSave,
    onResetSlug,
    checkSlugAvailability,
    reserveSlug,
    onSubscribe,
    subscribePriceLabel,
    initialReservation,
    autoStartSlugEdit,
}: Props) {
    const [seoSaving, setSeoSaving] = useState(false);
    const openResetConfirm = useResetBusinessSlugConfirmStore((s) => s.open);

    if (business.accessBlockedAt != null) {
        return (
            <UiSectionCard title="Публічна сторінка">
                <div className="mt-4">
                    <UiUpsellNote
                        message="Доступ призупинено, публічна сторінка і QR-коди неактивні. Поновіть доступ або видаліть отримувача."
                        ctaLabel="Поновити доступ"
                    />
                </div>
            </UiSectionCard>
        );
    }

    const hostnamePrefix = `${payPublicOrigin
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '')}/`;
    const publicUrl = `${payPublicOrigin.replace(/\/$/, '')}/${business.slug}`;
    const qrEndpoint = `${apiBase}/businesses/public/${encodeURIComponent(
        business.slug
    )}/qr/business.png`;

    const handleSeoToggle = async (next: boolean) => {
        setSeoSaving(true);
        try {
            await onSave({ seoIndexEnabled: next });
        } catch {
            toast.error('Не вдалося оновити SEO-налаштування');
        } finally {
            setSeoSaving(false);
        }
    };

    return (
        <UiSectionCard title="Публічна сторінка">
            <div className="divide-border mt-4 divide-y">
                <div className="pb-6">
                    <UiSlugEditor
                        currentSlug={business.slug}
                        prefix={hostnamePrefix}
                        publicUrl={publicUrl}
                        ariaLabel="Адреса сторінки"
                        isPaid={isPaid}
                        validate={(v) => {
                            const r = businessSlugSchema.safeParse(v);
                            return r.success
                                ? null
                                : (mapValidationCode(
                                      r.error.issues[0]?.message
                                  ) ?? null);
                        }}
                        checkAvailability={checkSlugAvailability}
                        reserve={reserveSlug}
                        onSave={(slug) => onSave({ slug })}
                        onRegenerate={() =>
                            openResetConfirm(() => {
                                void onResetSlug();
                            })
                        }
                        onSubscribe={onSubscribe}
                        subscribePriceLabel={subscribePriceLabel}
                        initialReservation={initialReservation}
                        autoStartEdit={autoStartSlugEdit}
                    />
                </div>
                <div className="py-6">
                    <UiQrPanel
                        endpoint={qrEndpoint}
                        params={{
                            v: qrBrandVersion(business.brand?.active?.logoUrl),
                        }}
                        description="Роздрукуйте код на вивісці, чеку чи візитці. Клієнт наведе камеру й одразу опиниться на вашій сторінці."
                        alt="QR на публічну сторінку отримувача"
                        downloadFilename={buildQrDownloadFilename('page', {
                            businessSlug: business.slug,
                        })}
                    />
                </div>
                <label
                    htmlFor="seo-toggle"
                    className="flex cursor-pointer flex-col gap-1 pt-6"
                >
                    <span className="flex items-center justify-between gap-3">
                        <span className="text-foreground text-lg font-medium">
                            {business.seoIndexEnabled
                                ? 'Сторінка відкрита для пошукової системи Google'
                                : 'Сторінка прихована від пошукової системи Google'}
                        </span>
                        <UiSwitch
                            id="seo-toggle"
                            className="shrink-0"
                            checked={business.seoIndexEnabled}
                            disabled={seoSaving}
                            onChange={(next) => void handleSeoToggle(next)}
                        />
                    </span>
                    <span className="text-muted-foreground text-sm">
                        Керує показом сторінки в пошуку Google. Зміни
                        відображаються не миттєво. Сторінка завжди доступна за
                        прямим посиланням.
                    </span>
                </label>
            </div>
        </UiSectionCard>
    );
}
