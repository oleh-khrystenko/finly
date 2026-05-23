'use client';

import {
    BANK_LABEL,
    BUSINESS_TYPE_LABEL,
    type BankCode,
    type BusinessType,
} from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiQrImage from '@/shared/ui/UiQrImage';
import { formatKopecksAsHryvnia } from '@/entities/invoice';

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
    };
    /**
     * Nested account view (Sprint 9 §SP-6). Клієнт бачить через який рахунок
     * іде платіж + `ibanMask` як disambiguator. URL-сегмент `account.slug`
     * потрібний для QR-endpoint (3-сегментний path).
     */
    account: {
        slug: string;
        name: string;
        bankCode: BankCode | null;
        ibanMask: string;
    };
    /**
     * NBU payload-link URLs. **`null` коли invoice expired** — server-side
     * blocks payment-vector після `validUntil < now` (Sprint 4 review fix).
     * Single source of truth: client не запитує QR-зображень коли nbuLinks=null
     * (QR endpoints у такому стані повертають 410 Gone defense-in-depth).
     */
    nbuLinks: { primary: string; legacy: string } | null;
    /** API endpoint origin для QR-картинок (`/api` для same-origin proxy). */
    apiBase?: string;
}

const DATE_LOCALE = 'uk-UA';

/**
 * Sprint 4 §4.7 + Sprint 9 §SP-6 — публічна сторінка інвойсу
 * `pay.finly.com.ua/{businessSlug}/{accountSlug}/{invoiceSlug}` (3-сегментна).
 *
 * Reusable у двох місцях:
 *   1. Cabinet preview-toggle на
 *      `business/{slug}/account/{accountSlug}/invoice/{invoiceSlug}`.
 *   2. Host-aware route `host-pay/{slug}/{accountSlug}/{invoiceSlug}`.
 *
 * **Sprint 9 §SP-6 — account-sub-info**: heading нижче-text-line містить
 * `"{BUSINESS_TYPE_LABEL[business.type]} {business.name} через {account.name}
 * ({BANK_LABEL[bankCode]} {ibanMask})"`. Null-fallback rule (§SP-9):
 *  - `bankCode === null` → BANK_LABEL-prefix drop-ається, `ibanMask` лишається.
 *
 * **Layout** — 2 NBU CTAs + 2 QR. 11-bank-grid свідомо прибраний до Sprint 5
 * розблокування per-bank deep-links (review fix Sprint 4).
 *
 * **Expired-banner sanity-block** — якщо API повернув `nbuLinks: null`
 * (server-side expiry block), заміщуємо payment-flow попередженням
 * "Термін рахунку минув". Server-side single source of truth: `nbuLinks=null`
 * — UI signal; client сам не порівнює `validUntil` (weak block, cached link,
 * scraping). QR endpoints у такому стані повертають 410 Gone.
 */
export default function InvoicePublicView({
    amount,
    amountLocked,
    paymentPurpose,
    validUntil,
    invoiceSlug,
    business,
    account,
    nbuLinks,
    apiBase = '/api',
}: Props) {
    const formattedAmount = formatKopecksAsHryvnia(amount);
    const heading = formattedAmount
        ? `Рахунок на ${formattedAmount}`
        : 'Рахунок на оплату';

    // §SP-9 null-fallback: bank-label лише на non-null bankCode; ibanMask
    // unconditional як server-derived disambiguator.
    const bankLabel =
        account.bankCode !== null ? BANK_LABEL[account.bankCode] : null;
    const accountParenthetical = bankLabel
        ? `(${bankLabel} ${account.ibanMask})`
        : `(${account.ibanMask})`;

    const qrPath = `${apiBase}/businesses/public/${encodeURIComponent(business.slug)}/account/${encodeURIComponent(account.slug)}/invoices/${encodeURIComponent(invoiceSlug)}/qr/nbu.png`;
    const qrPrimary = `${qrPath}?host=primary`;
    const qrLegacy = `${qrPath}?host=legacy`;

    return (
        <div className="mx-auto max-w-xl space-y-6 px-4 py-8">
            <header className="space-y-2 text-center">
                {/*
                 * `break-words` — захист від довгого user-controlled тексту
                 * (`business.name`, `account.name`, `paymentPurpose`) на 320px-
                 * екрані: без break-rule довгий рядок без пробілів дає
                 * horizontal scroll і ламає mobile-first layout.
                 */}
                <h1 className="text-foreground text-2xl font-bold tracking-tight break-words md:text-3xl">
                    {heading}
                </h1>
                <p className="text-muted-foreground text-sm break-words">
                    {BUSINESS_TYPE_LABEL[business.type]} {business.name} через{' '}
                    {account.name} {accountParenthetical}
                </p>
            </header>

            {/* Sub-info: призначення + термін дії */}
            <dl className="border-border bg-muted/40 grid gap-3 rounded-lg border p-4 text-sm">
                <div>
                    <dt className="text-muted-foreground text-xs">
                        Призначення
                    </dt>
                    <dd className="text-foreground mt-0.5 break-words">
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
                                  DATE_LOCALE
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

            {nbuLinks === null ? (
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
                    nbuLinks={nbuLinks}
                    qrPrimary={qrPrimary}
                    qrLegacy={qrLegacy}
                />
            )}
        </div>
    );
}

function PaymentSection({
    nbuLinks,
    qrPrimary,
    qrLegacy,
}: {
    nbuLinks: { primary: string; legacy: string };
    qrPrimary: string;
    qrLegacy: string;
}) {
    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <h2 className="text-foreground text-center text-base font-semibold">
                    Відкрити в банк-додатку
                </h2>
                {/* 2 active CTAs — зовнішні платіжні `bank://`-схеми, тож
                    native <a> через UiButton as="a" (Next <Link> підставив би
                    client-side router, який не знає про non-http протоколи). */}
                <UiButton
                    as="a"
                    href={nbuLinks.primary}
                    rel="external"
                    variant="filled"
                    size="md"
                    className="w-full"
                >
                    Відкрити в банку
                </UiButton>
                <UiButton
                    as="a"
                    href={nbuLinks.legacy}
                    rel="external"
                    variant="outline"
                    size="md"
                    className="w-full"
                >
                    Запасний варіант
                </UiButton>
                <p className="text-muted-foreground text-center text-xs">
                    Якщо ваш банк не відкрився — спробуйте запасний варіант
                </p>
            </div>

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
