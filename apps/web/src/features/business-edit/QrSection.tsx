'use client';

import type { Business } from '@finly/types';
import UiQrCard from '@/shared/ui/UiQrCard';
import UiSectionCard from '@/shared/ui/UiSectionCard';

interface Props {
    business: Business;
    apiBase?: string;
}

/**
 * Sprint 14 §UI — QR-секція бізнес-cabinet-page. На рівні бізнесу можливий
 * лише тип-2 (URL на публічну сторінку-вітрину): тип-1 (НБУ-payload) потребує
 * IBAN, а IBAN живе на рахунку, не на бізнесі.
 */
export default function QrSection({ business, apiBase = '/api' }: Props) {
    const endpoint = `${apiBase}/businesses/public/${encodeURIComponent(business.slug)}/qr/business.png`;

    return (
        <UiSectionCard title="QR-код">
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <UiQrCard
                    endpoint={endpoint}
                    title="Відкрити сторінку"
                    caption="Веде на публічну сторінку-вітрину бізнесу"
                    alt="QR на публічну сторінку бізнесу"
                    downloadFilename={`qr-${business.slug}.png`}
                />
            </div>
            <p className="text-muted-foreground mt-3 text-sm">
                Код веде на вітрину бізнесу з переліком рахунків. Зручно
                розмістити на вивісці чи у візитці.
            </p>
        </UiSectionCard>
    );
}
