'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { type Business } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';

interface Props {
    business: Business;
    /** Public payment-page origin (caller передає з `ENV.NEXT_PUBLIC_PAY_PUBLIC_URL`). */
    payPublicOrigin: string;
    /** Same-origin або /api proxy. */
    apiBase?: string;
}

function stripScheme(url: string): string {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export default function QrSection({
    business,
    payPublicOrigin,
    apiBase = '/api',
}: Props) {
    const [downloading, setDownloading] = useState(false);
    const url = `${apiBase}/businesses/public/${encodeURIComponent(business.slug)}/qr/business.png`;
    const payHost = stripScheme(payPublicOrigin);

    const handleDownload = async () => {
        setDownloading(true);
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = `qr-${business.slug}.png`;
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
                    alt={`QR на публічну сторінку ${business.name}`}
                    className="border-border aspect-square w-full max-w-[280px] rounded-md border bg-white p-3"
                    loading="lazy"
                />
            </div>
            <p className="text-muted-foreground mt-3 text-center text-xs">
                Скан веде на {payHost}/{business.slug}
            </p>
        </UiSectionCard>
    );
}
