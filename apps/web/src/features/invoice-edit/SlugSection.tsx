'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink, Pencil, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
    invoiceSlugSchema,
    type Invoice,
    type UpdateInvoiceRequest,
} from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiEditableField from '@/shared/ui/UiEditableField';
import UiPrefixInput from '@/shared/ui/UiPrefixInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import { mapValidationCode } from '@/shared/lib';
import { useResetInvoiceSlugConfirmStore } from './resetInvoiceSlugConfirmStore';

interface Props {
    invoice: Invoice;
    businessSlug: string;
    /** Sprint 9 §SP-5 — account-slug у public URL інвойсу (3-сегментна матрьошка). */
    accountSlug: string;
    /** Public payment-page origin (NEXT_PUBLIC_PAY_PUBLIC_URL). */
    payPublicOrigin: string;
    onSave: (patch: UpdateInvoiceRequest) => Promise<void>;
    /** Скидання slug-у на нове посилання за форматом нумерації (confirm-dialog). */
    onResetSlug: () => Promise<void>;
}

/**
 * Sprint 4 §4.6 + Sprint 9 §SP-5 + Sprint 15 — секція "Посилання на оплату".
 *
 * Sprint 15 робить invoice-slug редаговуваним vanity-string (раніше readonly).
 * Адреса — 3-сегментна матрьошка `{biz}/{acc}/{inv}`; редагується лише останній
 * сегмент (host + biz + acc у muted-prefix). Старе посилання ще працюватиме
 * певний час і вестиме на нову адресу (history-redirect на backend).
 */
export default function SlugSection({
    invoice,
    businessSlug,
    accountSlug,
    payPublicOrigin,
    onSave,
    onResetSlug,
}: Props) {
    const [copied, setCopied] = useState(false);
    const openResetConfirm = useResetInvoiceSlugConfirmStore((s) => s.open);

    const hostnamePrefix = `${payPublicOrigin
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '')}/${businessSlug}/${accountSlug}/`;
    const publicUrl = `${payPublicOrigin.replace(/\/$/, '')}/${businessSlug}/${accountSlug}/${invoice.slug}`;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(publicUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error('Не вдалося скопіювати');
        }
    };

    return (
        <UiSectionCard title="Посилання на оплату">
            <div className="mt-4">
                <UiEditableField<string>
                    value={invoice.slug}
                    hideDefaultPencil
                    renderRead={(_v, { startEdit }) => (
                        <div className="flex flex-col gap-3">
                            <span className="font-mono break-all">
                                <span className="text-muted-foreground">
                                    {hostnamePrefix}
                                </span>
                                <span className="text-foreground">
                                    {invoice.slug}
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
                            </div>
                        </div>
                    )}
                    renderEdit={({ value, setValue, error }) => (
                        <div className="flex flex-col gap-2">
                            <UiPrefixInput
                                prefix={hostnamePrefix}
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                error={error}
                                aria-label="Адреса інвойсу"
                                autoFocus
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellCheck={false}
                            />
                            <p className="text-muted-foreground text-sm">
                                Можна змінити на зрозумілу адресу. Старі збережені
                                посилання і надруковані QR ще певний час
                                працюватимуть і вестимуть на нову адресу.
                            </p>
                        </div>
                    )}
                    validate={(v) => {
                        const r = invoiceSlugSchema.safeParse(v);
                        return r.success
                            ? null
                            : (mapValidationCode(r.error.issues[0]?.message) ??
                                  null);
                    }}
                    onSave={(slug) => onSave({ slug })}
                />
            </div>
        </UiSectionCard>
    );
}
