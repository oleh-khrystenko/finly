'use client';

import {
    BANK_LABEL,
    MVP_BANKS,
    type BankCode,
    type BusinessType,
} from '@finly/types';
import { BANK_DISPLAY } from '@/shared/icons';
import UiButton from '@/shared/ui/UiButton';
import UiQrImage from '@/shared/ui/UiQrImage';

interface Props {
    /** Account-fields (з `PublicAccountViewSchema`-whitelist). */
    account: {
        slug: string;
        name: string;
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
 * генерується для триплета `(business, account)`. UI-шейп ідентичний Sprint 3
 * baseline-у:
 *   - heading зі звертанням + parenthetical disambiguator (§SP-9).
 *   - 11-bank-grid (inactive, до Sprint 5 per-bank deep-links).
 *   - 2 active NBU CTAs (primary + legacy app-link).
 *   - 2 QR-картинки (host=primary | host=legacy).
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
    const heading = `Платіж на користь ${business.name} через ${account.name}`;

    const qrBase = `${apiBase}/businesses/public/${encodeURIComponent(business.slug)}/account/${encodeURIComponent(account.slug)}/qr`;
    const qrPrimary = `${qrBase}/nbu.png?host=primary`;
    const qrLegacy = `${qrBase}/nbu.png?host=legacy`;
    const qrPage = `${qrBase}/business.png`;

    return (
        <div className="mx-auto max-w-xl space-y-8 px-4 py-8">
            <header className="space-y-2 text-center">
                <h1 className="text-foreground text-2xl font-bold tracking-tight break-words md:text-3xl">
                    {heading}
                </h1>
                <p className="text-muted-foreground text-sm break-words">
                    {parenthetical}
                </p>
            </header>

            <div className="space-y-3">
                <h2 className="text-foreground text-center text-base font-semibold">
                    Оберіть банк, з якого бажаєте оплатити
                </h2>
                {/*
                 * 11 inactive bank tiles. Іконка з `BANK_DISPLAY` map
                 * (`apps/web/src/shared/icons/banks/`). Grayscale + opacity-70 +
                 * cursor-not-allowed маркують inactive стан; Sprint 5 розблокує
                 * per-bank deep-links без зміни layout.
                 */}
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                    {MVP_BANKS.map((bank) => {
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

            <div className="space-y-3">
                {/* 2 active NBU CTAs — зовнішні платіжні `bank://`-схеми,
                    тож UiButton як native <a> (Next <Link> підставив би
                    client-side router, що не знає про non-http протоколи).
                    Symmetric до `InvoicePublicView` payment-section
                    (ui-primitives.md §1 — UiButton as="a" замість raw <a>). */}
                <UiButton
                    as="a"
                    href={nbuLinks.primary}
                    rel="external"
                    variant="filled"
                    size="md"
                    className="w-full"
                >
                    Інший банк
                </UiButton>
                <UiButton
                    as="a"
                    href={nbuLinks.legacy}
                    rel="external"
                    variant="outline"
                    size="md"
                    className="w-full"
                >
                    Інший банк (запасний варіант)
                </UiButton>
                <p className="text-muted-foreground text-center text-xs">
                    Якщо ваш банк не відкрився — спробуйте запасний варіант
                </p>
            </div>

            <div className="space-y-3">
                <h2 className="text-foreground text-center text-base font-semibold">
                    Сканувати для оплати в банку
                </h2>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <figure className="space-y-2 text-center">
                        <UiQrImage
                            src={qrPrimary}
                            alt="QR на основну адресу"
                            className="border-border mx-auto w-full max-w-[240px] rounded-md border bg-white"
                        />
                        <figcaption className="text-muted-foreground text-sm">
                            Основна адреса
                        </figcaption>
                    </figure>
                    <figure className="space-y-2 text-center">
                        <UiQrImage
                            src={qrLegacy}
                            alt="QR на запасну адресу"
                            className="border-border mx-auto w-full max-w-[240px] rounded-md border bg-white"
                        />
                        <figcaption className="text-muted-foreground text-sm">
                            Запасний варіант — якщо перший не відкрився
                        </figcaption>
                    </figure>
                </div>
            </div>

            <figure className="space-y-2 text-center">
                <UiQrImage
                    src={qrPage}
                    alt="QR на цю сторінку"
                    className="border-border mx-auto w-full max-w-[240px] rounded-md border bg-white"
                />
                <figcaption className="text-muted-foreground text-sm">
                    Відкрити цю сторінку — для вивіски чи поширення
                </figcaption>
            </figure>
        </div>
    );
}
