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
} from '@/entities/invoice';

interface Props {
    invoice: Invoice;
    businessSlug: string;
    /** Public-payment-page origin для побудови copy-link URL. */
    payPublicOrigin: string;
}

/**
 * Sprint 4 §4.4 — окрема картка інвойсу у списку секції "Рахунки".
 *
 * **Layout** — design-tokens borders + flex column. Status-badge у header-right
 * (як `BusinessCard.headerRight` у Sprint 3). Purpose truncate 2 lines через
 * Tailwind `line-clamp-2` — overflow-text не псує grid висоту карток.
 *
 * **Copy-link** — той самий patern, що `PublicSection` Sprint 3 (1.5s checkmark
 * fallback на toast-error при відмові clipboard API).
 */
export default function InvoiceCard({
    invoice,
    businessSlug,
    payPublicOrigin,
}: Props) {
    const [copied, setCopied] = useState(false);
    const publicUrl = `${payPublicOrigin.replace(/\/$/, '')}/${businessSlug}/${invoice.slug}`;
    const formattedAmount = formatKopecksAsHryvnia(invoice.amount);
    const status = getInvoiceStatus(invoice.validUntil);

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
        <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <p className="text-foreground text-base font-semibold">
                        {formattedAmount ?? 'Без суми (клієнт вводить)'}
                    </p>
                    <p
                        className="text-muted-foreground mt-1 text-xs font-mono truncate"
                        title={invoice.slug}
                    >
                        {invoice.slug}
                    </p>
                </div>
                <StatusBadge status={status} />
            </div>

            {invoice.paymentPurpose !== null && (
                <p className="text-muted-foreground line-clamp-2 text-sm">
                    {invoice.paymentPurpose}
                </p>
            )}
            {invoice.paymentPurpose === null && (
                <p className="text-muted-foreground/70 line-clamp-2 text-sm italic">
                    Призначення з налаштувань бізнесу
                </p>
            )}

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
                    href={`/business/${businessSlug}/invoice/${invoice.slug}`}
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
                    : 'bg-destructive/10 text-destructive',
            )}
        >
            {status === 'active' ? 'Активний' : 'Прострочено'}
        </span>
    );
}
