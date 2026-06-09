'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink, Pencil, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
    accountSlugSchema,
    type Account,
    type UpdateAccountRequest,
} from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiEditableField from '@/shared/ui/UiEditableField';
import UiPrefixInput from '@/shared/ui/UiPrefixInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import { mapValidationCode } from '@/shared/lib';
import QrSection from './QrSection';
import { useResetAccountSlugConfirmStore } from './resetAccountSlugConfirmStore';

interface Props {
    account: Account;
    businessSlug: string;
    /** Public payment-page origin (NEXT_PUBLIC_PAY_PUBLIC_URL). */
    payPublicOrigin: string;
    onSave: (patch: UpdateAccountRequest) => Promise<void>;
    /** Скидання slug-у на свіже випадкове посилання (через confirm-dialog). */
    onResetSlug: () => Promise<void>;
}

/**
 * Картка "Публічна сторінка" account-cabinet-page — дзеркало business
 * PublicSection. Один концепт «публічна адреса реквізитів» у двох рядках
 * (`divide-y`):
 *
 *  1. Адреса як редаговуване поле: host-prefix + businessSlug у muted-кольорі,
 *     account-slug у foreground, inline open/copy/edit/regenerate. Edit-mode
 *     дозволяє ФОП дати рахунку зрозумілий slug (`mono-cafe`); старе посилання
 *     ще працюватиме певний час і автоматично вестиме на нову адресу
 *     (history-redirect на backend), тому під полем — коротке пояснення.
 *  2. QR-коди (`QrSection`) — друге кодування тієї самої адреси для камери
 *     телефона. Раніше — окрема картка «QR-коди»; об'єднано в одну, бо URL і QR
 *     описують один публічний артефакт.
 */
export default function PublicSection({
    account,
    businessSlug,
    payPublicOrigin,
    onSave,
    onResetSlug,
}: Props) {
    const [copied, setCopied] = useState(false);
    const openResetConfirm = useResetAccountSlugConfirmStore((s) => s.open);

    const hostnamePrefix = `${payPublicOrigin
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '')}/${businessSlug}/`;
    const publicUrl = `${payPublicOrigin.replace(/\/$/, '')}/${businessSlug}/${account.slug}`;

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
        <UiSectionCard title="Публічна сторінка">
            <div className="divide-border mt-4 divide-y">
                <div className="pb-6">
                    <UiEditableField<string>
                        value={account.slug}
                        hideDefaultPencil
                        renderRead={(_v, { startEdit }) => (
                            <div className="flex flex-col gap-3">
                                <span className="font-mono break-all">
                                    <span className="text-muted-foreground">
                                        {hostnamePrefix}
                                    </span>
                                    <span className="text-foreground">
                                        {account.slug}
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
                                    aria-label="Адреса сторінки реквізитів"
                                    autoFocus
                                    autoCapitalize="off"
                                    autoCorrect="off"
                                    spellCheck={false}
                                />
                                <p className="text-muted-foreground text-sm">
                                    Можна змінити на зрозумілу адресу. Старі
                                    збережені посилання і надруковані QR ще
                                    певний час працюватимуть і вестимуть на нову
                                    адресу.
                                </p>
                            </div>
                        )}
                        validate={(v) => {
                            const r = accountSlugSchema.safeParse(v);
                            return r.success
                                ? null
                                : (mapValidationCode(
                                      r.error.issues[0]?.message
                                  ) ?? null);
                        }}
                        onSave={(slug) => onSave({ slug })}
                    />
                </div>
                <div className="pt-6">
                    <QrSection account={account} businessSlug={businessSlug} />
                </div>
            </div>
        </UiSectionCard>
    );
}
