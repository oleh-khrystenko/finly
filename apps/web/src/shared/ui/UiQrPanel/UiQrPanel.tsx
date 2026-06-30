'use client';

import { Download } from 'lucide-react';
import UiButton from '@/shared/ui/UiButton';
import UiQrImage from '@/shared/ui/UiQrImage';
import type { UiQrPanelProps } from './types';
import { useQrDownload, withQrQuery } from '@/shared/ui/UiQrCard/useQrDownload';

/**
 * Горизонтальний QR-блок: брендований код зліва (друкарський аспект, `w-60`),
 * праворуч — опційна назва-дія, пояснення і кнопка завантаження друкарського
 * розміру. Inline-зображення тягне екранний розмір; кнопка качає той самий
 * endpoint з `size=print&download=1` через спільний `useQrDownload`.
 *
 * На відміну від `UiQrCard` (вузька вертикальна картка для сітки) — широкий
 * layout для стекнутих блоків у картці «Публічна сторінка» (account/invoice/
 * business).
 */
const UiQrPanel = ({
    endpoint,
    params,
    title,
    description,
    alt,
    downloadFilename,
}: UiQrPanelProps) => {
    const { downloading, download } = useQrDownload(
        endpoint,
        downloadFilename,
        params
    );

    return (
        <div className="bg-muted/50 flex flex-col gap-6 rounded-lg p-4 sm:flex-row sm:items-center sm:gap-8">
            <div className="w-full shrink-0 sm:w-60">
                <UiQrImage
                    src={withQrQuery(endpoint, params)}
                    alt={alt}
                    className="rounded-md bg-white"
                />
            </div>
            <div className="flex flex-col items-start gap-3">
                <div className="flex flex-col gap-1">
                    {title && (
                        <p className="text-foreground text-lg font-medium">
                            {title}
                        </p>
                    )}
                    <p className="text-muted-foreground text-base">
                        {description}
                    </p>
                </div>
                <UiButton
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={() => void download()}
                    disabled={downloading}
                    IconLeft={<Download />}
                >
                    Завантажити
                </UiButton>
            </div>
        </div>
    );
};

UiQrPanel.displayName = 'UiQrPanel';

export default UiQrPanel;
