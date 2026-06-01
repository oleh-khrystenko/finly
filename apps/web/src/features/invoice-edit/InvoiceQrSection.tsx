'use client';

import { buildQrDownloadFilename, type Invoice } from '@finly/types';
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
 * Sprint 14 §UI — QR-секція інвойсу. Дзеркалить public-вигляд: два НБУ-коди
 * (тип-1, оплата в банку) + URL-код (тип-2, відкриває сторінку інвойсу).
 *
 * **Прострочений інвойс** — НБУ-коди приховані: `qr/nbu.png` після `validUntil`
 * повертає 410 Gone (server-side single source of truth), тож рендерити їх
 * було б битим зображенням. Код «Відкрити сторінку» лишається — веде на
 * публічну сторінку, яка сама показує банер «термін минув».
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
                    <>
                        <UiQrCard
                            endpoint={`${base}/nbu.png`}
                            params={{ host: 'primary' }}
                            title="Оплата в банку"
                            caption="Основна адреса (qr.bank.gov.ua)"
                            alt="QR за стандартом НБУ — основна адреса"
                            downloadFilename={buildQrDownloadFilename(
                                'payment-primary',
                                {
                                    businessSlug,
                                    accountSlug,
                                    invoiceSlug: invoice.slug,
                                }
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
                                {
                                    businessSlug,
                                    accountSlug,
                                    invoiceSlug: invoice.slug,
                                }
                            )}
                        />
                    </>
                )}
                <UiQrCard
                    endpoint={`${base}/business.png`}
                    title="Відкрити сторінку"
                    caption="Веде на публічну сторінку інвойсу"
                    alt="QR на публічну сторінку інвойсу"
                    downloadFilename={buildQrDownloadFilename('page', {
                        businessSlug,
                        accountSlug,
                        invoiceSlug: invoice.slug,
                    })}
                />
            </div>
            <p className="text-muted-foreground mt-3 text-sm">
                {isActive
                    ? 'Коди «Оплата в банку» відкривають банк-додаток із заповненими сумою та призначенням. Код «Відкрити сторінку» веде на публічну сторінку інвойсу.'
                    : 'Термін інвойсу минув — оплата в банку недоступна. Код «Відкрити сторінку» веде на публічну сторінку з поясненням для клієнта.'}
            </p>
        </UiSectionCard>
    );
}
