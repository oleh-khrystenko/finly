'use client';

import {
    accountSlugSchema,
    type Account,
    type SlugAvailabilityStatus,
    type SlugReservationView,
    type UpdateAccountRequest,
} from '@finly/types';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSlugEditor from '@/shared/ui/UiSlugEditor';
import { mapValidationCode } from '@/shared/lib';
import QrSection from './QrSection';
import { useResetAccountSlugConfirmStore } from './resetAccountSlugConfirmStore';

interface Props {
    account: Account;
    businessSlug: string;
    /** Версія бренду для cache-bust QR-картинки (`qrBrandVersion`). */
    brandVersion: string;
    /** Public payment-page origin (NEXT_PUBLIC_PAY_PUBLIC_URL). */
    payPublicOrigin: string;
    /** Платний рівень (brand+): Save пише slug одразу, інакше — бронь + апсел. */
    isPaid: boolean;
    onSave: (patch: UpdateAccountRequest) => Promise<void>;
    /** Скидання slug-у на свіже випадкове посилання (через confirm-dialog). */
    onResetSlug: () => Promise<void>;
    checkSlugAvailability: (slug: string) => Promise<SlugAvailabilityStatus>;
    reserveSlug: (slug: string) => Promise<SlugReservationView>;
    onSubscribe: () => void;
    subscribePriceLabel: string;
    initialReservation: SlugReservationView | null;
    autoStartSlugEdit: boolean;
}

/**
 * Картка "Публічна сторінка" account-cabinet-page — дзеркало business
 * PublicSection. Sprint 20: slug-рядок через `UiSlugEditor` (поле видиме всім,
 * гейт на Save: free → бронь + апсел). QR-коди — друге кодування тієї самої
 * адреси, у тій самій картці.
 */
export default function PublicSection({
    account,
    businessSlug,
    brandVersion,
    payPublicOrigin,
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
    const openResetConfirm = useResetAccountSlugConfirmStore((s) => s.open);

    const hostnamePrefix = `${payPublicOrigin
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '')}/${businessSlug}/`;
    const publicUrl = `${payPublicOrigin.replace(/\/$/, '')}/${businessSlug}/${account.slug}`;

    return (
        <UiSectionCard title="Публічна сторінка">
            <div className="divide-border mt-4 divide-y">
                <div className="pb-6">
                    <UiSlugEditor
                        currentSlug={account.slug}
                        prefix={hostnamePrefix}
                        publicUrl={publicUrl}
                        ariaLabel="Адреса сторінки реквізитів"
                        helpText="Можна змінити на зрозумілу адресу. Старі збережені посилання і надруковані QR ще певний час працюватимуть і вестимуть на нову адресу."
                        isPaid={isPaid}
                        validate={(v) => {
                            const r = accountSlugSchema.safeParse(v);
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
                <div className="pt-6">
                    <QrSection
                        account={account}
                        businessSlug={businessSlug}
                        brandVersion={brandVersion}
                    />
                </div>
            </div>
        </UiSectionCard>
    );
}
