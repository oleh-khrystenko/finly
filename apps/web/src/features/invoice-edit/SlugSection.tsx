'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { type Invoice } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';

interface Props {
    invoice: Invoice;
    businessSlug: string;
    /**
     * Sprint 9 §SP-5 — account-slug у public URL інвойсу.
     * Public-URL інвойсу стає 3-сегментним `{businessSlug}/{accountSlug}/{invoiceSlug}`.
     */
    accountSlug: string;
    /** Public payment-page origin (NEXT_PUBLIC_PAY_PUBLIC_URL). */
    payPublicOrigin: string;
}

/**
 * Sprint 4 §4.6 + Sprint 9 §SP-5 — секція "Slug" (readonly + copy + URL preview).
 * Slug invoice immutable після створення. Public URL — 3-сегментний матрьошка.
 */
export default function SlugSection({
    invoice,
    businessSlug,
    accountSlug,
    payPublicOrigin,
}: Props) {
    const [copied, setCopied] = useState(false);
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
            <div className="space-y-3">
                <div>
                    <p className="text-muted-foreground text-xs font-medium">
                        Slug інвойсу
                    </p>
                    <p className="text-foreground mt-1 font-mono text-sm break-all">
                        {invoice.slug}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                        Slug інвойсу незмінний після створення
                    </p>
                </div>
                <div>
                    <p className="text-muted-foreground text-xs font-medium">
                        Публічне посилання
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                        <code className="bg-muted text-foreground min-w-0 flex-1 truncate rounded-md px-2 py-1 text-xs">
                            {publicUrl}
                        </code>
                        <UiButton
                            type="button"
                            variant="icon"
                            size="sm"
                            onClick={() => void handleCopy()}
                            aria-label="Копіювати посилання"
                            IconLeft={copied ? <Check /> : <Copy />}
                        />
                    </div>
                </div>
            </div>
        </UiSectionCard>
    );
}
