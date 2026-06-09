'use client';

import { BANK_LABEL, type BankCode, type BusinessType } from '@finly/types';
import UiPaymentOptions from '@/shared/ui/UiPaymentOptions';
import UiPayeeCard from '@/shared/ui/UiPayeeCard';
import { formatPayeeName } from '@/entities/business';

interface Props {
    /** Account-fields (з `PublicAccountViewSchema`-whitelist). */
    account: {
        slug: string;
        name: string | null;
        bankCode: BankCode | null;
        ibanMask: string;
    };
    /** Nested business view (whitelist 4 поля). */
    business: {
        type: BusinessType;
        name: string;
        slug: string;
        seoIndexEnabled: boolean;
    };
    /**
     * NBU payload-link URLs. ОС handle через app-link → відкриває банк-додаток
     * з заповненими реквізитами. payload-data резолвиться backend-ом з
     * `(business, account)` triple.
     */
    nbuLinks: { primary: string; legacy: string };
    /** API endpoint origin для QR-картинок (`/api` для same-origin proxy). */
    apiBase?: string;
}

/**
 * Sprint 9 §SP-4 — public per-account вивіска
 * `pay.finly.com.ua/{businessSlug}/{accountSlug}`.
 *
 * Це Sprint 3 `PublicBusinessView` payment-view, переміщений на per-account
 * рівень: IBAN тепер живе на Account, тому payment-vector (NBU payload, QR)
 * генерується для триплета `(business, account)`:
 *   - hero-h1 = отримувач (`formatPayeeName` з юр-формою) — «кому платять».
 *   - `UiPayeeCard` — підписаний бокс реквізитів (банк + маска IBAN) — «по чому
 *     платять». Розділення замість злитого «Платіж на користь {X} через {Y}».
 *   - `UiPaymentOptions` — сітка банків + disclosure-сховані app-link і QR
 *     (спільний composite з `invoice-public`).
 *
 * **Null-fallback rule (§SP-9):** на `bankCode === null` банк-лейбл у реквізитах
 * drop-ається; `•{last4}`-маска показується unconditional як server-derived
 * disambiguator — єдина точка, де клієнт бачить ідентифікатор рахунку незалежно
 * від name-стану (ФОП перейменував рахунок → маска лишається з IBAN-документа).
 */
export default function PublicAccountView({
    account,
    business,
    nbuLinks,
    apiBase = '/api',
}: Props) {
    // §SP-9 — bank-label лише на non-null bankCode; last4-маска unconditional.
    const bankLabel =
        account.bankCode !== null ? BANK_LABEL[account.bankCode] : null;
    // Отримувач — hero сторінки (це і є мета вивіски: «кому ви платите»).
    // Реквізити («по чому») винесено в окремий підписаний бокс нижче, замість
    // злитого «Платіж на користь {X} через {Y}».
    const payeeName = formatPayeeName(business.type, business.name);

    const qrBase = `${apiBase}/businesses/public/${encodeURIComponent(business.slug)}/account/${encodeURIComponent(account.slug)}/qr`;
    const qrPrimary = `${qrBase}/nbu.png?host=primary`;
    const qrLegacy = `${qrBase}/nbu.png?host=legacy`;

    return (
        <div className="mx-auto max-w-md space-y-6 px-4 py-8 md:max-w-2xl">
            <header className="space-y-1 text-center">
                <p className="text-muted-foreground text-sm">Отримувач</p>
                <h1 className="text-foreground text-2xl font-bold tracking-tight break-words md:text-3xl">
                    {payeeName}
                </h1>
            </header>

            <UiPayeeCard
                bankLabel={bankLabel}
                ibanMask={account.ibanMask}
                accountName={account.name}
            />

            <UiPaymentOptions
                nbuLinks={nbuLinks}
                qrPrimary={qrPrimary}
                qrLegacy={qrLegacy}
            />
        </div>
    );
}
