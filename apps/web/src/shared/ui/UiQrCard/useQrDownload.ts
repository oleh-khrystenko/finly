'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { PRINT_QR_SIZE_NAME } from '@finly/types';

/** Додає query-параметри до QR-endpoint-а (порожні — повертає endpoint as-is). */
export function withQrQuery(
    endpoint: string,
    params?: Record<string, string>
): string {
    const query = new URLSearchParams(params).toString();
    return query ? `${endpoint}?${query}` : endpoint;
}

/**
 * Завантаження QR друкарського розміру через fetch+blob (а не прямий
 * `<a download>`) — щоб показати стан кнопки і toast на помилку. Єдине джерело
 * логіки: `UiQrCard` (рахунок/інвойс) і бізнес-секція «Публічна сторінка»
 * рендерять різні layout-и, але качають однаково.
 */
export function useQrDownload(
    endpoint: string,
    downloadFilename: string,
    params?: Record<string, string>
) {
    const [downloading, setDownloading] = useState(false);

    const download = async () => {
        setDownloading(true);
        try {
            const url = withQrQuery(endpoint, {
                ...params,
                size: PRINT_QR_SIZE_NAME,
                download: '1',
            });
            const res = await fetch(url);
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

    return { downloading, download };
}
