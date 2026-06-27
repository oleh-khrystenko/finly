'use client';

import { BANK_LABEL, type BankCode, type BusinessType } from '@finly/types';
import UiBrandLogo from '@/shared/ui/UiBrandLogo';
import UiPaymentOptions from '@/shared/ui/UiPaymentOptions';
import UiPayeeCard from '@/shared/ui/UiPayeeCard';
import { qrBrandVersion } from '@/shared/lib';
import { formatPayeeName } from '@/entities/business';
import { formatKopecksAsHryvnia } from '@/entities/invoice';

interface Props {
    /** Invoice fields (з `PublicInvoiceView`-whitelist). */
    amount: number | null;
    /**
     * Effective purpose (resolved через `effectiveInvoicePurpose` на backend).
     * Нерозкривний `null` у public-view: inheritance-rule вже розв'язана;
     * клієнт завжди бачить актуальний текст (той самий, що NBU payload).
     */
    paymentPurpose: string;
    validUntil: Date | null;
    invoiceSlug: string;
    /** Nested business view (+ опційний бренд Sprint 21). */
    business: {
        type: BusinessType;
        name: string;
        slug: string;
        logo?: string;
        brandDisplayName?: string | null;
    };
    /**
     * Nested account view (Sprint 9 §SP-6). Клієнт бачить через який рахунок
     * іде платіж + `ibanMask` як disambiguator. URL-сегмент `account.slug`
     * потрібний для QR-endpoint (3-сегментний path).
     */
    account: {
        slug: string;
        name: string | null;
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
 * **Layout** — hero-h1 = сума («Рахунок на {amount}»); під ним `UiPayeeCard`
 * розділяє «кому» (Отримувач, `formatPayeeName` з юр-формою) і «по чому»
 * (Реквізити: банк + маска IBAN) замість злитого sub-info-рядка. Далі —
 * призначення/термін + `UiPaymentOptions` (сітка банків + disclosure-сховані
 * app-link та QR), спільний composite з `account-public`. Null-fallback rule
 * (§SP-9): на `bankCode === null` банк-лейбл drop-ається, `ibanMask` лишається.
 *
 * **Expired-banner sanity-block** — якщо API повернув `nbuLinks: null`
 * (server-side expiry block), заміщуємо payment-flow попередженням
 * "Термін рахунку минув". Server-side single source of truth: `nbuLinks=null`
 * — UI signal; client сам не порівнює `validUntil` (weak block, cached link,
 * scraping). QR endpoints у такому стані повертають 410 Gone.
 */
export default function InvoicePublicView({
    amount,
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
    const payeeName = formatPayeeName(business.type, business.name);
    const validUntilLabel =
        validUntil !== null
            ? new Date(validUntil).toLocaleDateString(DATE_LOCALE)
            : null;

    const qrBase = `${apiBase}/businesses/public/${encodeURIComponent(business.slug)}/account/${encodeURIComponent(account.slug)}/invoices/${encodeURIComponent(invoiceSlug)}/qr`;
    // cache-bust QR-картинки версією бренду (`qrBrandVersion`): зміна логотипа
    // дає новий токен → новий URL → свіже зображення замість закешованого.
    const brandVersion = qrBrandVersion(business.logo);
    const qrPrimary = `${qrBase}/nbu.png?host=primary&v=${brandVersion}`;
    const qrLegacy = `${qrBase}/nbu.png?host=legacy&v=${brandVersion}`;

    return (
        <div className="mx-auto max-w-md space-y-6 px-4 py-8 md:max-w-2xl">
            <header className="flex flex-col items-center gap-3 text-center">
                {business.logo && (
                    <UiBrandLogo
                        src={business.logo}
                        alt={business.brandDisplayName ?? payeeName}
                        displayName={business.brandDisplayName}
                    />
                )}
                {/*
                 * `break-words` — захист від довгого user-controlled тексту
                 * (`heading` з amount) на 320px-екрані: без break-rule довгий
                 * рядок без пробілів дає horizontal scroll і ламає mobile-first.
                 */}
                <h1 className="text-foreground text-2xl font-bold tracking-tight break-words md:text-3xl">
                    {heading}
                </h1>
            </header>

            {/* Ідентичність платежу: «кому» (Отримувач) + «по чому» (Реквізити) */}
            <UiPayeeCard
                recipient={payeeName}
                bankLabel={bankLabel}
                ibanMask={account.ibanMask}
                accountName={account.name}
            />

            {/* Sub-info: призначення + (лише за наявності) майбутній термін.
                «Без терміну» не показуємо — відсутність рядка = без обмеження.
                У expired-стані термін несе банер нижче, не нейтральний рядок. */}
            <dl className="border-border bg-muted/40 divide-border divide-y rounded-lg border text-sm">
                <div className="flex flex-col gap-1 p-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                    <dt className="text-muted-foreground">Призначення</dt>
                    <dd className="text-foreground break-words sm:text-right">
                        {paymentPurpose}
                    </dd>
                </div>
                {validUntil !== null && nbuLinks !== null && (
                    <div className="flex flex-col gap-1 p-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                        <dt className="text-muted-foreground">Дійсний до</dt>
                        <dd className="text-foreground sm:text-right">
                            {validUntilLabel}
                        </dd>
                    </div>
                )}
            </dl>

            {nbuLinks === null ? (
                <div className="border-destructive/30 bg-destructive/5 rounded-lg border p-6 text-center">
                    <p className="text-destructive text-base font-semibold">
                        Термін оплати минув
                    </p>
                    <p className="text-muted-foreground mt-2 text-sm">
                        {validUntilLabel
                            ? `Цей рахунок був дійсний до ${validUntilLabel} і більше недоступний для оплати. Зверніться до отримувача, щоб отримати актуальне посилання.`
                            : 'Цей рахунок більше недоступний для оплати. Зверніться до отримувача, щоб отримати актуальне посилання.'}
                    </p>
                </div>
            ) : (
                <UiPaymentOptions
                    nbuLinks={nbuLinks}
                    qrPrimary={qrPrimary}
                    qrLegacy={qrLegacy}
                />
            )}
        </div>
    );
}
