'use client';

import { buildQrDownloadFilename, type Account } from '@finly/types';
import UiQrCard from '@/shared/ui/UiQrCard';
import UiSectionCard from '@/shared/ui/UiSectionCard';

interface Props {
    account: Account;
    businessSlug: string;
    apiBase?: string;
}

/**
 * Sprint 14 §UI — QR-секція на account-cabinet-page. Дзеркалить public-вигляд:
 * два НБУ-коди (тип-1, оплата в банку — основна + альтернативна адреса) і
 * URL-код (тип-2, відкриває публічну сторінку рахунку). Кожна картка має
 * кнопку завантаження друкарського розміру.
 *
 * До Sprint 14 секція показувала лише два НБУ-коди; тип-2 (`qr/business.png`)
 * був orphan на frontend. Тепер обидва типи видимі — підписи розрізняють дію
 * (платити vs відкрити сторінку).
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
                    title="Оплата в банку"
                    caption="Основна адреса (qr.bank.gov.ua)"
                    alt="QR за стандартом НБУ — основна адреса"
                    downloadFilename={buildQrDownloadFilename(
                        'payment-primary',
                        { businessSlug, accountSlug: account.slug }
                    )}
                />
                <UiQrCard
                    endpoint={`${base}/nbu.png`}
                    params={{ host: 'legacy' }}
                    title="Оплата в банку"
                    caption="Альтернативна адреса (bank.gov.ua/qr)"
                    alt="QR за стандартом НБУ — альтернативна адреса"
                    downloadFilename={buildQrDownloadFilename(
                        'payment-legacy',
                        { businessSlug, accountSlug: account.slug }
                    )}
                />
                <UiQrCard
                    endpoint={`${base}/business.png`}
                    title="Відкрити сторінку"
                    caption="Веде на публічну сторінку рахунку"
                    alt="QR на публічну сторінку рахунку"
                    downloadFilename={buildQrDownloadFilename('page', {
                        businessSlug,
                        accountSlug: account.slug,
                    })}
                />
            </div>
            <p className="text-muted-foreground mt-3 text-sm">
                Коди «Оплата в банку» ведуть на ту саму платіжну команду — деякі
                банки підтримують лише одну з адрес. Код «Відкрити сторінку» веде
                на публічну сторінку рахунку, де клієнт сам обирає банк.
            </p>
        </UiSectionCard>
    );
}
