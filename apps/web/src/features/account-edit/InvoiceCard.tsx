'use client';

import { useState } from 'react';
import { ArrowRight, Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { type Invoice } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import { composeClasses } from '@/shared/lib';
import {
    formatKopecksAsHryvnia,
    getInvoiceStatus,
    isInvoicePurposeRuntimeInherited,
    resolveInvoicePayeePurpose,
} from '@/entities/invoice';

interface Props {
    invoice: Invoice;
    businessSlug: string;
    accountSlug: string;
    /**
     * Template для legacy fallback (`payeeSnapshot === null && payment
     * Purpose === null`) — той самий runtime-resolution-path, що backend
     * `payload-mapper`. Передається з batch-fetch-у `Business`-документу на
     * parent-сторінці.
     */
    businessPaymentPurposeTemplate: string;
    /** Public-payment-page origin для побудови copy-link URL. */
    payPublicOrigin: string;
}

/**
 * Sprint 4 §4.4 + Sprint 9 §SP-5 — окрема картка інвойсу у списку секції
 * "Інвойси" на account-cabinet-page.
 *
 * **Sprint 9 URL-update**: public-URL стає 3-сегментним —
 * `{payOrigin}/{businessSlug}/{accountSlug}/{invoiceSlug}`. Cabinet-link
 * — `/business/{biz}/account/{acc}/invoice/{inv}` (матрьошка §SP-5).
 */
export default function InvoiceCard({
    invoice,
    businessSlug,
    accountSlug,
    businessPaymentPurposeTemplate,
    payPublicOrigin,
}: Props) {
    const [copied, setCopied] = useState(false);
    const publicUrl = `${payPublicOrigin.replace(/\/$/, '')}/${businessSlug}/${accountSlug}/${invoice.slug}`;
    const formattedAmount = formatKopecksAsHryvnia(invoice.amount);
    const status = getInvoiceStatus(invoice.validUntil);
    const purpose = resolveInvoicePayeePurpose(
        invoice.payeeSnapshot,
        invoice.paymentPurpose,
        businessPaymentPurposeTemplate
    );
    const isRuntimeInherited = isInvoicePurposeRuntimeInherited(
        invoice.payeeSnapshot,
        invoice.paymentPurpose
    );

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
        <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <p className="text-foreground text-xl font-semibold tracking-tight">
                        {formattedAmount ?? 'Без суми (клієнт вводить)'}
                    </p>
                    <p
                        className="text-muted-foreground mt-1 truncate font-mono text-base"
                        title={invoice.slug}
                    >
                        {invoice.slug}
                    </p>
                </div>
                <StatusBadge status={status} />
            </div>

            <p
                className={composeClasses(
                    'line-clamp-2 text-base',
                    isRuntimeInherited
                        ? 'text-muted-foreground/70 italic'
                        : 'text-muted-foreground'
                )}
                title={
                    isRuntimeInherited
                        ? 'Успадковано з налаштувань отримувача'
                        : undefined
                }
            >
                {purpose}
            </p>

            <div className="flex items-center gap-2 pt-1">
                <UiButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleCopy()}
                    IconLeft={copied ? <Check /> : <Copy />}
                    className="flex-1 justify-center"
                >
                    {copied ? 'Скопійовано' : 'Скопіювати'}
                </UiButton>
                <UiButton
                    as="link"
                    href={`/business/${businessSlug}/account/${accountSlug}/invoice/${invoice.slug}`}
                    variant="filled"
                    size="sm"
                    IconRight={<ArrowRight />}
                    className="flex-1 justify-center"
                >
                    Відкрити
                </UiButton>
            </div>
        </div>
    );
}

function StatusBadge({ status }: { status: 'active' | 'expired' }) {
    return (
        <span
            className={composeClasses(
                'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
                status === 'active'
                    ? 'bg-secondary text-foreground'
                    : 'bg-destructive/10 text-destructive'
            )}
        >
            {status === 'active' ? 'Активний' : 'Прострочено'}
        </span>
    );
}
