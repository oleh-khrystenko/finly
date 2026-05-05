'use client';

import {
    BANK_LABEL,
    BUSINESS_TYPE_LABEL,
    type BankCode,
    type BusinessType,
} from '@finly/types';
import { BANK_DISPLAY } from '@/shared/icons';
import UiQrImage from '@/shared/ui/UiQrImage';
import {
    formatKopecksAsHryvnia,
    getInvoiceStatus,
} from '@/features/invoices/formatKopecks';

interface Props {
    /** Invoice fields (з `PublicInvoiceView`-whitelist). */
    amount: number | null;
    amountLocked: boolean;
    /**
     * Effective purpose (resolved через `effectiveInvoicePurpose` на backend).
     * Нерозкривний `null` у public-view: inheritance-rule вже розв'язана;
     * клієнт завжди бачить актуальний текст (той самий, що NBU payload).
     */
    paymentPurpose: string;
    validUntil: Date | null;
    invoiceSlug: string;
    /** Nested business view. */
    business: {
        type: BusinessType;
        name: string;
        slug: string;
        acceptedBanks: BankCode[];
    };
    /** NBU payload-link URLs (з payload, що містить amount + lockMask + validUntil). */
    nbuLinks: { primary: string; legacy: string };
    /** API endpoint origin для QR-картинок (`/api` для same-origin proxy). */
    apiBase?: string;
}

const DATE_LOCALE = 'uk-UA';

/**
 * Sprint 4 §4.7 — публічна сторінка інвойсу. Reusable у двох місцях:
 *   1. Cabinet preview-toggle на `business/{slug}/invoice/{invoiceSlug}` (§4.6).
 *   2. Host-aware route `host-pay/{slug}/{invoiceSlug}` (§4.7).
 *
 * **Layout** — той самий 11-bank-grid + 2 NBU CTAs + 2 QR що Sprint 3
 * `PublicBusinessView`, плюс invoice-overlay:
 *   - Заголовок з amount (`"Рахунок на 1 500,00 ₴"` або `"Рахунок на оплату"`
 *     якщо amount=null).
 *   - Sub-info блок: "Призначення: {purpose}" + "Дійсний до: {date}".
 *
 * **Expired-banner sanity-block** — якщо `validUntil < now`, заміщує весь
 * payment-flow (банки + кнопки + QR) попередженням "Термін рахунку минув".
 * Банк-додаток сам не valid-ate validUntil robustly, тож user-side block —
 * додатковий шар захисту.
 */
export default function InvoicePublicView({
    amount,
    amountLocked,
    paymentPurpose,
    validUntil,
    invoiceSlug,
    business,
    nbuLinks,
    apiBase = '/api',
}: Props) {
    const formattedAmount = formatKopecksAsHryvnia(amount);
    const heading = formattedAmount
        ? `Рахунок на ${formattedAmount}`
        : 'Рахунок на оплату';
    const status = getInvoiceStatus(validUntil);

    const qrPrimary = `${apiBase}/businesses/public/${encodeURIComponent(business.slug)}/invoices/${encodeURIComponent(invoiceSlug)}/qr/nbu.png?host=primary`;
    const qrLegacy = `${apiBase}/businesses/public/${encodeURIComponent(business.slug)}/invoices/${encodeURIComponent(invoiceSlug)}/qr/nbu.png?host=legacy`;

    return (
        <div className="mx-auto max-w-xl space-y-6 px-4 py-8">
            <header className="space-y-2 text-center">
                <h1 className="text-foreground text-2xl font-bold tracking-tight md:text-3xl">
                    {heading}
                </h1>
                <p className="text-muted-foreground text-sm">
                    {BUSINESS_TYPE_LABEL[business.type]} {business.name}
                </p>
            </header>

            {/* Sub-info: призначення + термін дії */}
            <dl className="border-border bg-muted/40 grid gap-3 rounded-lg border p-4 text-sm">
                <div>
                    <dt className="text-muted-foreground text-xs">
                        Призначення
                    </dt>
                    <dd className="text-foreground mt-0.5">
                        {paymentPurpose}
                    </dd>
                </div>
                <div>
                    <dt className="text-muted-foreground text-xs">
                        Дійсний до
                    </dt>
                    <dd className="text-foreground mt-0.5">
                        {validUntil === null
                            ? 'Без терміну'
                            : new Date(validUntil).toLocaleDateString(
                                  DATE_LOCALE,
                              )}
                    </dd>
                </div>
                {amount !== null && amountLocked && (
                    <p className="text-muted-foreground text-xs italic">
                        Сума зафіксована, редагування у банку недоступне
                    </p>
                )}
                {amount !== null && !amountLocked && (
                    <p className="text-muted-foreground text-xs italic">
                        Можна змінити суму у банк-додатку перед оплатою
                    </p>
                )}
            </dl>

            {status === 'expired' ? (
                <div className="border-destructive/30 bg-destructive/5 rounded-lg border p-6 text-center">
                    <p className="text-destructive text-base font-semibold">
                        Термін рахунку минув
                    </p>
                    <p className="text-muted-foreground mt-2 text-sm">
                        Зверніться до отримувача за новим посиланням на оплату.
                    </p>
                </div>
            ) : (
                <PaymentSection
                    business={business}
                    nbuLinks={nbuLinks}
                    qrPrimary={qrPrimary}
                    qrLegacy={qrLegacy}
                />
            )}
        </div>
    );
}

function PaymentSection({
    business,
    nbuLinks,
    qrPrimary,
    qrLegacy,
}: {
    business: { acceptedBanks: BankCode[] };
    nbuLinks: { primary: string; legacy: string };
    qrPrimary: string;
    qrLegacy: string;
}) {
    return (
        <div className="space-y-6">
            {/* 11 inactive bank tiles (Sprint 5 розблокує per-bank deep-links). */}
            <div className="space-y-3">
                <h2 className="text-foreground text-center text-base font-semibold">
                    Оберіть банк, з якого бажаєте оплатити
                </h2>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                    {business.acceptedBanks.map((bank) => {
                        const Icon = BANK_DISPLAY[bank];
                        return (
                            <div
                                key={bank}
                                aria-disabled
                                className="border-border bg-muted/30 text-muted-foreground flex h-20 cursor-not-allowed flex-col items-center justify-center gap-1.5 rounded-md border px-2 text-center opacity-70 grayscale"
                                title="Незабаром"
                            >
                                <div className="size-10">
                                    <Icon />
                                </div>
                                <span className="text-[10px] leading-tight">
                                    {BANK_LABEL[bank]}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 2 active CTAs */}
            <div className="space-y-3">
                <a
                    href={nbuLinks.primary}
                    rel="external"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 flex w-full items-center justify-center rounded-md px-4 py-3 text-sm font-semibold transition-colors"
                >
                    Інший банк
                </a>
                <a
                    href={nbuLinks.legacy}
                    rel="external"
                    className="border-border text-muted-foreground hover:bg-accent flex w-full items-center justify-center rounded-md border px-4 py-3 text-sm font-medium transition-colors"
                >
                    Інший банк (запасний варіант)
                </a>
                <p className="text-muted-foreground text-center text-xs">
                    Якщо ваш банк не відкрився — спробуйте запасний варіант
                </p>
            </div>

            {/* 2 QR images */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <figure className="space-y-2 text-center">
                    <UiQrImage
                        src={qrPrimary}
                        alt="QR на основну адресу"
                        className="border-border mx-auto w-full max-w-[240px] rounded-md border bg-white p-2"
                    />
                    <figcaption className="text-muted-foreground text-xs">
                        Або відскануйте з вашого банк-додатка
                    </figcaption>
                </figure>
                <figure className="space-y-2 text-center">
                    <UiQrImage
                        src={qrLegacy}
                        alt="QR на запасну адресу"
                        className="border-border mx-auto w-full max-w-[240px] rounded-md border bg-white p-2"
                    />
                    <figcaption className="text-muted-foreground text-xs">
                        Запасний варіант — якщо перший QR не відкрився
                    </figcaption>
                </figure>
            </div>
        </div>
    );
}
