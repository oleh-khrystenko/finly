'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import type { Account } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiQrImage from '@/shared/ui/UiQrImage';
import UiSectionCard from '@/shared/ui/UiSectionCard';

interface Props {
    account: Account;
    businessSlug: string;
    apiBase?: string;
}

/**
 * Sprint 9 §9.2 §6 — QR-секція на account-cabinet-page. **Рівно 2 NBU QR**
 * (primary + legacy), symmetric до public per-account-page і Sprint 3
 * `PublicBusinessView` pattern. Cabinet mirror-ить public 1:1 — ФОП бачить
 * той самий image-set, що його клієнт.
 *
 * **`qr/business.png`-endpoint навмисно НЕ використовується** — він orphan
 * на frontend (Sprint 3 spec, успадковано): public payment-page рендерить
 * тільки два NBU QR, business.png зарезервований для майбутніх use-case-ів
 * (друк / окреме скачування) і не входить у visible UI. Sprint 9 цю
 * семантику зберігає.
 */
export default function QrSection({
    account,
    businessSlug,
    apiBase = '/api',
}: Props) {
    return (
        <UiSectionCard title="QR-картинки">
            <div className="grid gap-4 sm:grid-cols-2">
                <NbuQrCard
                    account={account}
                    businessSlug={businessSlug}
                    apiBase={apiBase}
                    host="primary"
                    label="Основна (qr.bank.gov.ua)"
                />
                <NbuQrCard
                    account={account}
                    businessSlug={businessSlug}
                    apiBase={apiBase}
                    host="legacy"
                    label="Альтернативна (bank.gov.ua/qr)"
                />
            </div>
            <p className="text-muted-foreground mt-3 text-center text-xs">
                Обидва коди ведуть на ту саму платіжну команду. Деякі банки
                підтримують лише одну з адрес.
            </p>
        </UiSectionCard>
    );
}

interface NbuCardProps {
    account: Account;
    businessSlug: string;
    apiBase: string;
    host: 'primary' | 'legacy';
    label: string;
}

function NbuQrCard({
    account,
    businessSlug,
    apiBase,
    host,
    label,
}: NbuCardProps) {
    const [downloading, setDownloading] = useState(false);
    const url = `${apiBase}/businesses/public/${encodeURIComponent(businessSlug)}/account/${encodeURIComponent(account.slug)}/qr/nbu.png?host=${host}`;

    const handleDownload = async () => {
        setDownloading(true);
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = `qr-nbu-${host}-${account.slug}.png`;
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
        <div className="border-border flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
                <p className="text-foreground text-sm font-medium">{label}</p>
                <UiButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleDownload()}
                    disabled={downloading}
                    IconLeft={<Download />}
                >
                    PNG
                </UiButton>
            </div>
            <UiQrImage
                src={url}
                alt={`QR за стандартом НБУ (${label})`}
                className="w-full rounded-md bg-white p-3"
            />
        </div>
    );
}
