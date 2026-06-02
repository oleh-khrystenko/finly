'use client';

import { Download } from 'lucide-react';
import UiButton from '@/shared/ui/UiButton';
import UiQrImage from '@/shared/ui/UiQrImage';
import type { UiQrCardProps } from './types';
import { useQrDownload, withQrQuery } from './useQrDownload';

/**
 * Sprint 14 — cabinet QR-картка: брендований код + кнопка завантаження
 * друкарського розміру. Inline-зображення тягне дефолтний (екранний) розмір;
 * кнопка качає той самий endpoint з `size=print&download=1` (attachment) через
 * спільний `useQrDownload`.
 */
const UiQrCard = ({
    endpoint,
    params,
    title,
    caption,
    alt,
    downloadFilename,
}: UiQrCardProps) => {
    const { downloading, download } = useQrDownload(
        endpoint,
        downloadFilename,
        params
    );
    const inlineSrc = withQrQuery(endpoint, params);

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
                    onClick={() => void download()}
                    disabled={downloading}
                    IconLeft={<Download />}
                >
                    Завантажити
                </UiButton>
            </div>
            <UiQrImage
                src={inlineSrc}
                alt={alt}
                className="w-full rounded-md bg-white"
            />
        </div>
    );
};

UiQrCard.displayName = 'UiQrCard';

export default UiQrCard;
