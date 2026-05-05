'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { type Invoice } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';

interface Props {
    invoice: Invoice;
    businessSlug: string;
    apiBase?: string;
}

/**
 * Sprint 4 §4.6 — секція "QR-картинка" для інвойсу. Показує public-URL QR
 * (canonical-URL інвойсу: `pay.finly.com.ua/{businessSlug}/{invoiceSlug}`).
 *
 * **Patern ідентичний Sprint 3 `QrSection` для бізнесу** — `<img>` з public
 * endpoint, кнопка "Завантажити" через blob+anchor; toast-error на failure.
 */
export default function InvoiceQrSection({
    invoice,
    businessSlug,
    apiBase = '/api',
}: Props) {
    const [downloading, setDownloading] = useState(false);
    const url = `${apiBase}/businesses/public/${encodeURIComponent(
        businessSlug,
    )}/invoices/${encodeURIComponent(invoice.slug)}/qr/business.png`;

    const handleDownload = async () => {
        setDownloading(true);
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = `qr-invoice-${invoice.slug}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(objectUrl);
        } catch {
            toast.error('Не вдалося завантажити QR');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <UiSectionCard
            title="QR-картинка"
            headerRight={
                <UiButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleDownload()}
                    disabled={downloading}
                    IconLeft={<Download />}
                >
                    Завантажити
                </UiButton>
            }
        >
            <div className="mt-3 flex justify-center">
                <img
                    src={url}
                    alt={`QR на сторінку оплати рахунку ${invoice.slug}`}
                    className="border-border aspect-square w-full max-w-[280px] rounded-md border bg-white p-3"
                    loading="lazy"
                />
            </div>
            <p className="text-muted-foreground mt-3 text-center text-xs">
                Скан веде на публічну сторінку рахунку з реквізитами та сумою
            </p>
        </UiSectionCard>
    );
}
