'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink, Pencil, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
    buildQrDownloadFilename,
    businessSlugSchema,
    type Business,
    type UpdateBusinessRequest,
} from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiEditableField from '@/shared/ui/UiEditableField';
import UiPrefixInput from '@/shared/ui/UiPrefixInput';
import UiQrPanel from '@/shared/ui/UiQrPanel';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSwitch from '@/shared/ui/UiSwitch';
import UiUpsellNote from '@/shared/ui/UiUpsellNote';
import { mapValidationCode } from '@/shared/lib';
import { useCanEditSlug } from '@/entities/user';
import { useResetBusinessSlugConfirmStore } from './resetBusinessSlugConfirmStore';

interface Props {
    business: Business;
    /** Public payment-page origin (NEXT_PUBLIC_PAY_PUBLIC_URL чи аналог). */
    payPublicOrigin: string;
    apiBase?: string;
    onSave: (patch: UpdateBusinessRequest) => Promise<void>;
    /** Скидання slug-у на свіже випадкове посилання (через confirm-dialog). */
    onResetSlug: () => Promise<void>;
}

/**
 * Sprint 14: slug + public URL — один концепт (адреса публічної сторінки),
 * рендериться як єдине поле через `UiEditableField`. Раніше було два окремі
 * рядки що дублювали slug-значення (раз "Slug: Xv0RTvfe", раз
 * "Посилання: pay.finly.com.ua/Xv0RTvfe").
 *
 * Read mode — host-prefix у muted-кольорі + slug у foreground (Twitter/GitHub-
 * стиль) + inline copy-button; pencil-action рендерить UiEditableField.
 * Edit mode — composite input з немутабельним prefix у `bg-secondary` лівій
 * частині і редагованою slug-частиною праворуч (єдина рамка).
 *
 * Підписковий gate (free-tier — slug random, paid — vanity-edit) приходить
 * разом з білінгом окремим спринтом; зараз slug відкритий для всіх.
 *
 * QR-код тут — не окрема секція, а друге кодування тієї самої адреси
 * (URL — для людини, QR — для камери телефона), тому живе в одній картці
 * під дією-посиланнями. На бізнес-рівні можливий лише тип-2 (URL на вітрину):
 * тип-1 (НБУ-payload) потребує IBAN, а IBAN живе на рахунку, не на бізнесі.
 */
export default function PublicSection({
    business,
    payPublicOrigin,
    apiBase = '/api',
    onSave,
    onResetSlug,
}: Props) {
    const [copied, setCopied] = useState(false);
    const [seoSaving, setSeoSaving] = useState(false);
    const openResetConfirm = useResetBusinessSlugConfirmStore((s) => s.open);
    const canEditSlug = useCanEditSlug();

    const hostnamePrefix = `${payPublicOrigin
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '')}/`;
    const publicUrl = `${payPublicOrigin.replace(/\/$/, '')}/${business.slug}`;
    const qrEndpoint = `${apiBase}/businesses/public/${encodeURIComponent(
        business.slug
    )}/qr/business.png`;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(publicUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error('Не вдалося скопіювати');
        }
    };

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
                    <UiEditableField<string>
                        value={business.slug}
                        hideDefaultPencil
                        renderRead={(_v, { startEdit }) => (
                            <div className="flex flex-col gap-3">
                                <span className="font-mono break-all">
                                    <span className="text-muted-foreground">
                                        {hostnamePrefix}
                                    </span>
                                    <span className="text-foreground">
                                        {business.slug}
                                    </span>
                                </span>
                                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                                    <UiButton
                                        as="a"
                                        href={publicUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        variant="outline"
                                        size="md"
                                        IconLeft={<ExternalLink />}
                                        className="w-full sm:w-auto"
                                    >
                                        Відкрити в новій вкладці
                                    </UiButton>
                                    <UiButton
                                        type="button"
                                        variant="outline"
                                        size="md"
                                        onClick={() => void handleCopy()}
                                        IconLeft={copied ? <Check /> : <Copy />}
                                        className="w-full sm:w-auto"
                                    >
                                        {copied ? 'Скопійовано' : 'Копіювати'}
                                    </UiButton>
                                    {canEditSlug && (
                                        <>
                                            <UiButton
                                                type="button"
                                                variant="outline"
                                                size="md"
                                                onClick={startEdit}
                                                IconLeft={<Pencil />}
                                                className="w-full sm:w-auto"
                                            >
                                                Редагувати
                                            </UiButton>
                                            <UiButton
                                                type="button"
                                                variant="outline"
                                                size="md"
                                                onClick={() =>
                                                    openResetConfirm(() => {
                                                        void onResetSlug();
                                                    })
                                                }
                                                IconLeft={<RefreshCw />}
                                                className="w-full sm:w-auto"
                                            >
                                                Згенерувати нове посилання
                                            </UiButton>
                                        </>
                                    )}
                                </div>
                                {!canEditSlug && (
                                    <UiUpsellNote message="Власне посилання (slug) доступне на тарифі «Свій бренд»" />
                                )}
                            </div>
                        )}
                        renderEdit={({ value, setValue, error }) => (
                            <UiPrefixInput
                                prefix={hostnamePrefix}
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                error={error}
                                aria-label="Адреса сторінки"
                                autoFocus
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellCheck={false}
                            />
                        )}
                        validate={(v) => {
                            const r = businessSlugSchema.safeParse(v);
                            return r.success
                                ? null
                                : (mapValidationCode(
                                      r.error.issues[0]?.message
                                  ) ?? null);
                        }}
                        onSave={(slug) => onSave({ slug })}
                    />
                </div>
                <div className="py-6">
                    <UiQrPanel
                        endpoint={qrEndpoint}
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
