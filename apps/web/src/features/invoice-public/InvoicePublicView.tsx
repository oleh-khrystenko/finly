'use client';

import {
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
        acceptedBanks: BankCode[];
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
 * Sprint 4 §4.7 — публічна сторінка інвойсу. Reusable у двох місцях:
 *   1. Cabinet preview-toggle на `business/{slug}/invoice/{invoiceSlug}` (§4.6).
 *   2. Host-aware route `host-pay/{slug}/{invoiceSlug}` (§4.7).
 *
 * **Layout (Sprint 4 review fix)** — 2 NBU CTAs ("Відкрити в банку" / "Запасний
 * варіант") + 2 QR. 11-bank-grid (як у Sprint 3 `PublicBusinessView`) свідомо
 * прибраний до Sprint 5 розблокування per-bank deep-links: dead-grid із
 * tooltip-only-hint-ом не давав робочого UX (на mobile tooltip invisible) і
 * приховував primary route оплати. Sprint 5 поверне grid у активному вигляді
 * як основний CTA.
 *
 * Над payment-section:
 *   - Заголовок з amount (`"Рахунок на 1 500,00 ₴"` або `"Рахунок на оплату"`
 *     якщо amount=null).
 *   - Sub-info блок: "Призначення: {purpose}" + "Дійсний до: {date}".
 *
 * **Expired-banner sanity-block** — якщо API повернув `nbuLinks: null`
 * (server-side expiry block), заміщуємо весь payment-flow (CTAs + QR)
 * попередженням "Термін рахунку минув". Раніше client-side `getInvoiceStatus`
 * порівнював `validUntil` з now, але `nbuLinks` все одно прилітали у JSON —
 * weak block (cached link, scraping). Тепер expiry-resolution живе на сервері:
 * `nbuLinks === null` — single source of truth для UI. QR endpoints у такому
 * стані повертають 410 Gone (defense-in-depth).
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

    const qrPrimary = `${apiBase}/businesses/public/${encodeURIComponent(business.slug)}/invoices/${encodeURIComponent(invoiceSlug)}/qr/nbu.png?host=primary`;
    const qrLegacy = `${apiBase}/businesses/public/${encodeURIComponent(business.slug)}/invoices/${encodeURIComponent(invoiceSlug)}/qr/nbu.png?host=legacy`;

    return (
        <div className="mx-auto max-w-xl space-y-6 px-4 py-8">
            <header className="space-y-2 text-center">
                {/*
                 * `break-words` (overflow-wrap: break-word) — захист від
                 * довгого user-controlled тексту (`business.name`,
                 * `paymentPurpose`) на 320px-екрані: без break-rule довгий
                 * рядок без пробілів дав би horizontal scroll і зламав
                 * mobile-first layout (responsive policy §1).
                 */}
                <h1 className="text-foreground text-2xl font-bold tracking-tight break-words md:text-3xl">
                    {heading}
                </h1>
                <p className="text-muted-foreground break-words text-sm">
                    {BUSINESS_TYPE_LABEL[business.type]} {business.name}
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
            {/*
             * Sprint 4 — 11-bank-grid НЕ показуємо до Sprint 5 розблокування
             * per-bank deep-links (раніше тут був dead-grid із title="Незабаром"
             * tooltip-ом, що на mobile invisible). Натомість єдиний universal
             * NBU CTA + QR — обидва робочі шляхи. Sprint 5 поверне grid у
             * активному вигляді як primary CTA.
             */}
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
