'use client';

import { buildQrDownloadFilename, type Account } from '@finly/types';
import UiDisclosure from '@/shared/ui/UiDisclosure';
import UiQrPanel from '@/shared/ui/UiQrPanel';

interface Props {
    account: Account;
    businessSlug: string;
    apiBase?: string;
}

/**
 * QR-блок усередині картки «Публічна сторінка» (account-cabinet-page) — друге
 * кодування тієї самої публічної адреси: URL для людини (рядок вище), QR для
 * камери телефона. Layout — `UiQrPanel`: великий горизонтальний блок (QR зліва,
 * опис + завантаження праворуч).
 *
 * Порядок дій: спочатку «QR-вивіска» (тип-2, `qr/business.png`) — веде на
 * публічну сторінку реквізитів, для друку/вітрини; нижче — «QR для оплати в
 * банку» (тип-1, НБУ primary-host), який клієнт сканує банк-додатком і одразу
 * бачить заповнений платіж.
 *
 * Запасний НБУ-код (legacy-host, для старіших банк-парсерів) схований під
 * disclosure — потрібен рідко, тож не конкурує за увагу з основними.
 */
export default function QrSection({
    account,
    businessSlug,
    apiBase = '/api',
}: Props) {
    const base = `${apiBase}/businesses/public/${encodeURIComponent(businessSlug)}/account/${encodeURIComponent(account.slug)}/qr`;

    return (
        <div className="space-y-4">
            <UiQrPanel
                endpoint={`${base}/business.png`}
                title="QR-вивіска на сторінку реквізитів"
                description="Роздрукуйте на вивісці, чеку чи візитці. Клієнт наведе камеру й одразу опиниться на сторінці реквізитів."
                alt="QR на публічну сторінку реквізитів"
                downloadFilename={buildQrDownloadFilename('page', {
                    businessSlug,
                    accountSlug: account.slug,
                })}
            />
            <UiQrPanel
                endpoint={`${base}/nbu.png`}
                params={{ host: 'primary' }}
                title="QR для оплати в банку"
                description="Клієнт сканує код банк-додатком і одразу бачить заповнений платіж."
                alt="QR за стандартом НБУ для оплати в банку"
                downloadFilename={buildQrDownloadFilename('payment-primary', {
                    businessSlug,
                    accountSlug: account.slug,
                })}
            />
            <UiDisclosure label="Запасний QR для старіших банків">
                <UiQrPanel
                    endpoint={`${base}/nbu.png`}
                    params={{ host: 'legacy' }}
                    title="Запасний код для оплати"
                    description="Покажіть його, якщо банк клієнта не зчитав основний код для оплати."
                    alt="QR за стандартом НБУ (запасна адреса)"
                    downloadFilename={buildQrDownloadFilename(
                        'payment-legacy',
                        {
                            businessSlug,
                            accountSlug: account.slug,
                        }
                    )}
                />
            </UiDisclosure>
        </div>
    );
}
