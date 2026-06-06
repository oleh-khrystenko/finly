'use client';

import { BANK_LABEL, type BankCode, type BusinessType } from '@finly/types';
import UiPaymentOptions from '@/shared/ui/UiPaymentOptions';

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
 *   - heading зі звертанням + parenthetical disambiguator (§SP-9).
 *   - `UiPaymentOptions` — сітка банків + disclosure-сховані app-link і QR
 *     (спільний composite з `invoice-public`).
 *
 * **Heading-formula (§SP-9):**
 *  - `bankCode !== null` → `"Платіж на користь {business.name} через {account.name}
 *    ({BANK_LABEL[bankCode]} •{last4})"`.
 *  - `bankCode === null` → `"Платіж на користь {business.name} через {account.name}
 *    (•{last4})"` (BANK_LABEL-prefix drop-ається; `•{last4}`-postfix
 *    unconditional як server-derived disambiguator).
 *
 * **Чому `•{last4}` unconditional**: heading — єдина точка на per-account-
 * вивісці, де клієнт бачить ідентифікатор рахунку незалежно від name-стану.
 * Якщо ФОП перейменував рахунок з auto-default "ПриватБанк •2580" на
 * "Основний", `•2580` у parenthetical лишається — server-derived з IBAN-
 * документа.
 */
export default function PublicAccountView({
    account,
    business,
    nbuLinks,
    apiBase = '/api',
}: Props) {
    // §SP-9 — bank-label лише на non-null bankCode; last4-postfix unconditional.
    const bankLabel =
        account.bankCode !== null ? BANK_LABEL[account.bankCode] : null;
    const parenthetical = bankLabel
        ? `(${bankLabel} ${account.ibanMask})`
        : `(${account.ibanMask})`;
    // Без власної назви рахунку опускаємо "через {назва}" — parenthetical нижче
    // вже ідентифікує рахунок (банк + маска), тож дубль не потрібен.
    const heading = account.name
        ? `Платіж на користь ${business.name} через ${account.name}`
        : `Платіж на користь ${business.name}`;

    const qrBase = `${apiBase}/businesses/public/${encodeURIComponent(business.slug)}/account/${encodeURIComponent(account.slug)}/qr`;
    const qrPrimary = `${qrBase}/nbu.png?host=primary`;
    const qrLegacy = `${qrBase}/nbu.png?host=legacy`;

    return (
        <div className="mx-auto max-w-md space-y-8 px-4 py-8">
            <header className="space-y-2 text-center">
                <h1 className="text-foreground text-2xl font-bold tracking-tight break-words md:text-3xl">
                    {heading}
                </h1>
                <p className="text-muted-foreground text-sm break-words">
                    {parenthetical}
                </p>
            </header>

            <UiPaymentOptions
                nbuLinks={nbuLinks}
                qrPrimary={qrPrimary}
                qrLegacy={qrLegacy}
            />
        </div>
    );
}
