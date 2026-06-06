'use client';

import { buildQrDownloadFilename, type Invoice } from '@finly/types';
import UiDisclosure from '@/shared/ui/UiDisclosure';
import UiQrCard from '@/shared/ui/UiQrCard';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import { getInvoiceStatus } from '@/entities/invoice';

interface Props {
    invoice: Invoice;
    businessSlug: string;
    /** Sprint 9 §SP-5 — account-slug у public-URL інвойсу (3-сегментний матрьошка). */
    accountSlug: string;
    apiBase?: string;
}

/**
 * QR-секція інвойсу — дві чіткі дії (симетрично account-cabinet):
 *  - «QR для оплати в банку» (тип-1, НБУ primary-host) — клієнт сканує й
 *    одразу бачить заповнені суму та призначення.
 *  - «QR на сторінку рахунку» (тип-2, `qr/business.png`) — для друку чи
 *    надсилання клієнту.
 *
 * Запасний НБУ-код (legacy-host) схований під disclosure. Технічні host-
 * адреси з підписів прибрано.
 *
 * **Прострочений інвойс** — НБУ-коди приховані: `qr/nbu.png` після `validUntil`
 * повертає 410 Gone (server-side single source of truth), тож рендерити їх
 * було б битим зображенням. Лишається лише код на сторінку — вона сама
 * показує банер «термін минув».
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
    const isActive = getInvoiceStatus(invoice.validUntil, new Date()) === 'active';

    return (
        <UiSectionCard title="QR-коди">
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {isActive && (
                    <UiQrCard
                        endpoint={`${base}/nbu.png`}
                        params={{ host: 'primary' }}
                        title="QR для оплати в банку"
                        caption="Клієнт сканує, банк-додаток одразу заповнює суму та призначення"
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
                <UiQrCard
                    endpoint={`${base}/business.png`}
                    title="QR на сторінку рахунку"
                    caption="Надрукувати або надіслати клієнту"
                    alt="QR на публічну сторінку рахунку"
                    downloadFilename={buildQrDownloadFilename('page', {
                        businessSlug,
                        accountSlug,
                        invoiceSlug: invoice.slug,
                    })}
                />
            </div>
            {isActive && (
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
                                {
                                    businessSlug,
                                    accountSlug,
                                    invoiceSlug: invoice.slug,
                                }
                            )}
                        />
                    </div>
                </UiDisclosure>
            )}
            <p className="text-muted-foreground mt-4 text-sm">
                {isActive
                    ? '«QR для оплати» клієнт сканує банк-додатком і одразу бачить заповнені суму та призначення. Другий код веде на сторінку рахунку, його зручно надіслати клієнту.'
                    : 'Термін рахунку минув, оплата в банку недоступна. Код веде на публічну сторінку з поясненням для клієнта.'}
            </p>
        </UiSectionCard>
    );
}
