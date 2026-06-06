'use client';

import { buildQrDownloadFilename, type Account } from '@finly/types';
import UiDisclosure from '@/shared/ui/UiDisclosure';
import UiQrCard from '@/shared/ui/UiQrCard';
import UiSectionCard from '@/shared/ui/UiSectionCard';

interface Props {
    account: Account;
    businessSlug: string;
    apiBase?: string;
}

/**
 * QR-секція на account-cabinet-page — дві чіткі дії замість трьох карток
 * (дві з яких раніше мали ідентичний заголовок «Оплата в банку» і плутали):
 *
 *  - «QR для оплати в банку» (тип-1, НБУ primary-host) — клієнт сканує
 *    банк-додатком і одразу бачить заповнений платіж.
 *  - «QR-вивіска» (тип-2, `qr/business.png`) — веде на публічну сторінку
 *    реквізитів; для друку, вітрини, вкладення в рахунок.
 *
 * Запасний НБУ-код (legacy-host, для старіших банк-парсерів) схований під
 * disclosure — він потрібен рідко, тож не конкурує за увагу з основними.
 * Технічні host-адреси з підписів прибрано — ФОП їх не розшифровує.
 */
export default function QrSection({
    account,
    businessSlug,
    apiBase = '/api',
}: Props) {
    const base = `${apiBase}/businesses/public/${encodeURIComponent(businessSlug)}/account/${encodeURIComponent(account.slug)}/qr`;

    return (
        <UiSectionCard title="QR-коди">
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <UiQrCard
                    endpoint={`${base}/nbu.png`}
                    params={{ host: 'primary' }}
                    title="QR для оплати в банку"
                    caption="Клієнт сканує, банк-додаток одразу заповнює реквізити"
                    alt="QR за стандартом НБУ для оплати в банку"
                    downloadFilename={buildQrDownloadFilename(
                        'payment-primary',
                        { businessSlug, accountSlug: account.slug }
                    )}
                />
                <UiQrCard
                    endpoint={`${base}/business.png`}
                    title="QR-вивіска"
                    caption="Надрукувати, наклеїти на вітрину, вкласти в рахунок"
                    alt="QR на публічну сторінку реквізитів"
                    downloadFilename={buildQrDownloadFilename('page', {
                        businessSlug,
                        accountSlug: account.slug,
                    })}
                />
            </div>
            <UiDisclosure
                className="mt-4"
                label="Запасний QR для старіших банків"
            >
                <div className="grid gap-4 sm:grid-cols-2">
                    <UiQrCard
                        endpoint={`${base}/nbu.png`}
                        params={{ host: 'legacy' }}
                        title="Запасний код для оплати"
                        caption="Якщо банк клієнта не зчитав основний"
                        alt="QR за стандартом НБУ — запасна адреса"
                        downloadFilename={buildQrDownloadFilename(
                            'payment-legacy',
                            { businessSlug, accountSlug: account.slug }
                        )}
                    />
                </div>
            </UiDisclosure>
            <p className="text-muted-foreground mt-4 text-sm">
                «QR для оплати» клієнт сканує банк-додатком і одразу бачить
                заповнений платіж. «QR-вивіску» зручно роздрукувати: вона веде на
                сторінку реквізитів, де клієнт сам обирає банк.
            </p>
        </UiSectionCard>
    );
}
