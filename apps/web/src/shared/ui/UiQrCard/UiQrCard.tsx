'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { PRINT_QR_SIZE_NAME } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiQrImage from '@/shared/ui/UiQrImage';
import type { UiQrCardProps } from './types';

function withQuery(
    endpoint: string,
    params?: Record<string, string>
): string {
    const query = new URLSearchParams(params).toString();
    return query ? `${endpoint}?${query}` : endpoint;
}

/**
 * Sprint 14 — cabinet QR-картка: брендований код + кнопка завантаження
 * друкарського розміру. Inline-зображення тягне дефолтний (екранний) розмір;
 * кнопка веде на той самий endpoint з `size=print&download=1` (attachment).
 *
 * Завантаження через fetch+blob (а не прямий `<a download>`) — щоб показати
 * стан і toast-помилку; це той самий патерн, що раніше дублювався у
 * `account-edit` / `invoice-edit` QR-секціях, тепер єдиний.
 */
const UiQrCard = ({
    endpoint,
    params,
    title,
    caption,
    alt,
    downloadFilename,
}: UiQrCardProps) => {
    const [downloading, setDownloading] = useState(false);
    const inlineSrc = withQuery(endpoint, params);
    const downloadUrl = withQuery(endpoint, {
        ...params,
        size: PRINT_QR_SIZE_NAME,
        download: '1',
    });

    const handleDownload = async () => {
        setDownloading(true);
        try {
            const res = await fetch(downloadUrl);
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = downloadFilename;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(objectUrl);
        } catch {
            toast.error('Не вдалося завантажити QR');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="border-border flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-foreground text-sm font-medium">
                        {title}
                    </p>
                    {caption && (
                        <p className="text-muted-foreground mt-0.5 text-sm">
                            {caption}
                        </p>
                    )}
                </div>
                <UiButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleDownload()}
                    disabled={downloading}
                    IconLeft={<Download />}
                >
                    Друк
                </UiButton>
            </div>
            <UiQrImage
                src={inlineSrc}
                alt={alt}
                className="w-full rounded-md bg-white p-3"
            />
        </div>
    );
};

UiQrCard.displayName = 'UiQrCard';

export default UiQrCard;
