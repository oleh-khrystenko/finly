'use client';

import {
    invoiceSlugSchema,
    type AutoSlugMode,
    type Invoice,
    type SlugAvailabilityStatus,
    type SlugReservationView,
    type UpdateInvoiceRequest,
} from '@finly/types';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSlugEditor from '@/shared/ui/UiSlugEditor';
import UiUpsellNote from '@/shared/ui/UiUpsellNote';
import { mapValidationCode } from '@/shared/lib';
import InvoiceQrSection from './InvoiceQrSection';
import { useResetInvoiceSlugConfirmStore } from './resetInvoiceSlugConfirmStore';

interface Props {
    invoice: Invoice;
    businessSlug: string;
    /** Sprint 9 §SP-5 — account-slug у public URL інвойсу (3-сегментна матрьошка). */
    accountSlug: string;
    /** Public payment-page origin (NEXT_PUBLIC_PAY_PUBLIC_URL). */
    payPublicOrigin: string;
    /**
     * Sprint 19 — отримувача заблоковано реконсиляцією: публічні ендпоінти
     * віддають 404, рендеримо «доступ призупинено».
     */
    accessSuspended: boolean;
    /** Платний рівень (brand+): Save пише slug одразу, інакше — бронь + апсел. */
    isPaid: boolean;
    onSave: (patch: UpdateInvoiceRequest) => Promise<void>;
    /** «Домашній формат» рахунку — picker перевипуску відкривається на ньому. */
    defaultMode: AutoSlugMode | null;
    /** Скидання slug-у на нове посилання за обраним у діалозі форматом. */
    onResetSlug: (mode: AutoSlugMode) => Promise<void>;
    checkSlugAvailability: (slug: string) => Promise<SlugAvailabilityStatus>;
    reserveSlug: (slug: string) => Promise<SlugReservationView>;
    onSubscribe: () => void;
    subscribePriceLabel: string;
    initialReservation: SlugReservationView | null;
    autoStartSlugEdit: boolean;
}

/**
 * Sprint 4 §4.6 + Sprint 9 §SP-5 + Sprint 15 + Sprint 20 — картка "Публічна
 * сторінка" документа. URL для людини зверху (через `UiSlugEditor`: поле видиме
 * всім, free → бронь + апсел на Save), QR для камери знизу.
 *
 * Адреса — 3-сегментна матрьошка `{biz}/{acc}/{inv}`; редагується лише останній
 * сегмент (host + biz + acc у muted-prefix).
 */
export default function SlugSection({
    invoice,
    businessSlug,
    accountSlug,
    payPublicOrigin,
    accessSuspended,
    isPaid,
    onSave,
    defaultMode,
    onResetSlug,
    checkSlugAvailability,
    reserveSlug,
    onSubscribe,
    subscribePriceLabel,
    initialReservation,
    autoStartSlugEdit,
}: Props) {
    const openResetConfirm = useResetInvoiceSlugConfirmStore((s) => s.open);

    if (accessSuspended) {
        return (
            <UiSectionCard title="Публічна сторінка">
                <div className="mt-4">
                    <UiUpsellNote
                        message="Доступ до отримувача призупинено, публічна сторінка і QR-коди неактивні. Поновіть доступ або видаліть отримувача."
                        ctaLabel="Поновити доступ"
                    />
                </div>
            </UiSectionCard>
        );
    }

    const hostnamePrefix = `${payPublicOrigin
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '')}/${businessSlug}/${accountSlug}/`;
    const publicUrl = `${payPublicOrigin.replace(/\/$/, '')}/${businessSlug}/${accountSlug}/${invoice.slug}`;

    return (
        <UiSectionCard title="Публічна сторінка">
            <div className="divide-border mt-4 divide-y">
                <div className="pb-6">
                    <UiSlugEditor
                        currentSlug={invoice.slug}
                        prefix={hostnamePrefix}
                        publicUrl={publicUrl}
                        ariaLabel="Адреса рахунку"
                        helpText="Можна змінити на зрозумілу адресу. Старі збережені посилання і надруковані QR ще певний час працюватимуть і вестимуть на нову адресу."
                        isPaid={isPaid}
                        validate={(v) => {
                            const r = invoiceSlugSchema.safeParse(v);
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
                            openResetConfirm({
                                defaultMode,
                                onConfirm: (mode) => {
                                    void onResetSlug(mode);
                                },
                            })
                        }
                        onSubscribe={onSubscribe}
                        subscribePriceLabel={subscribePriceLabel}
                        initialReservation={initialReservation}
                        autoStartEdit={autoStartSlugEdit}
                    />
                </div>
                <div className="pt-6">
                    <InvoiceQrSection
                        invoice={invoice}
                        businessSlug={businessSlug}
                        accountSlug={accountSlug}
                    />
                </div>
            </div>
        </UiSectionCard>
    );
}
