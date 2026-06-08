'use client';

import { buildQrDownloadFilename, type Invoice } from '@finly/types';
import UiDisclosure from '@/shared/ui/UiDisclosure';
import UiQrPanel from '@/shared/ui/UiQrPanel';
import { getInvoiceStatus } from '@/entities/invoice';

interface Props {
    invoice: Invoice;
    businessSlug: string;
    /** Sprint 9 §SP-5 — account-slug у public-URL інвойсу (3-сегментний матрьошка). */
    accountSlug: string;
    apiBase?: string;
}

/**
 * QR-блок усередині картки «Публічна сторінка» інвойсу — друге кодування тієї
 * самої публічної адреси. Layout — `UiQrPanel`: великий горизонтальний блок (QR
 * зліва, опис + завантаження праворуч).
 *
 * Порядок дій: спочатку «QR-вивіска» (тип-2, `qr/business.png`) — веде на
 * публічну сторінку рахунку, для друку чи надсилання клієнту; нижче — «QR для
 * оплати в банку» (тип-1, НБУ primary-host), який клієнт сканує банк-додатком і
 * одразу бачить заповнені суму та призначення. Запасний НБУ-код (legacy-host)
 * схований під disclosure.
 *
 * **Прострочений інвойс** — НБУ-коди приховані: `qr/nbu.png` після `validUntil`
 * повертає 410 Gone (server-side single source of truth), тож рендерити їх було
 * б битим зображенням. Лишається лише код на сторінку — вона сама показує банер
 * «термін минув».
 */
export default function InvoiceQrSection({
    invoice,
    businessSlug,
    accountSlug,
    apiBase = '/api',
}: Props) {
    const base = `${apiBase}/businesses/public/${encodeURIComponent(
        businessSlug
    )}/account/${encodeURIComponent(accountSlug)}/invoices/${encodeURIComponent(invoice.slug)}/qr`;
    const isActive =
        getInvoiceStatus(invoice.validUntil, new Date()) === 'active';

    return (
        <div className="space-y-4">
            <UiQrPanel
                endpoint={`${base}/business.png`}
                title="QR-вивіска на сторінку рахунку"
                description="Роздрукуйте або надішліть клієнту. Він наведе камеру й одразу опиниться на сторінці рахунку."
                alt="QR на публічну сторінку рахунку"
                downloadFilename={buildQrDownloadFilename('page', {
                    businessSlug,
                    accountSlug,
                    invoiceSlug: invoice.slug,
                })}
            />
            {isActive && (
                <UiQrPanel
                    endpoint={`${base}/nbu.png`}
                    params={{ host: 'primary' }}
                    title="QR для оплати в банку"
                    description="Клієнт сканує код банк-додатком і одразу бачить заповнені суму та призначення."
                    alt="QR за стандартом НБУ для оплати в банку"
                    downloadFilename={buildQrDownloadFilename(
                        'payment-primary',
                        {
                            businessSlug,
                            accountSlug,
                            invoiceSlug: invoice.slug,
                        }
                    )}
                />
            )}
            {isActive ? (
                <UiDisclosure label="Запасний QR для старіших банків">
                    <UiQrPanel
                        endpoint={`${base}/nbu.png`}
                        params={{ host: 'legacy' }}
                        title="Запасний код для оплати"
                        description="Покажіть його, якщо банк клієнта не зчитав основний код для оплати."
                        alt="QR за стандартом НБУ — запасна адреса"
                        downloadFilename={buildQrDownloadFilename(
                            'payment-legacy',
                            {
                                businessSlug,
                                accountSlug,
                                invoiceSlug: invoice.slug,
                            }
                        )}
                    />
                </UiDisclosure>
            ) : (
                <p className="text-muted-foreground text-sm">
                    Термін рахунку минув, оплата в банку недоступна. Код веде на
                    публічну сторінку з поясненням для клієнта.
                </p>
            )}
        </div>
    );
}
