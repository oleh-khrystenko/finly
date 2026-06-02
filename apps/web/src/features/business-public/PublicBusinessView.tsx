import { ArrowRight } from 'lucide-react';
import {
    BANK_LABEL,
    type BusinessType,
    type PublicAccountListItem,
} from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiQrImage from '@/shared/ui/UiQrImage';

interface Props {
    /**
     * Sprint 7 §SP-5 — `type` лишається у Props для майбутніх SEO-meta /
     * aria-label use-case-ів. H1-heading його не використовує (тип-нейтральне
     * формулювання Sprint 7 §SP-5).
     */
    type: BusinessType;
    name: string;
    slug: string;
    /**
     * Sprint 9 §SP-4: server-side already відрізнив 0/1/2+ → цей view рендериться
     * тільки для `accounts.length === 0` (empty-state) або `>= 2` (list-of-cards).
     * 1-Account випадок резолвиться `redirect()` у Server Component перед render-ом.
     */
    accounts: PublicAccountListItem[];
    /** API endpoint origin для QR-картинки (`/api` для same-origin proxy). */
    apiBase?: string;
}

/**
 * Sprint 9 §SP-4 — публічна root-вивіска бізнесу `pay.finly.com.ua/{businessSlug}`.
 *
 * **До Sprint 9** був full-payment view з QR-кодами на business-level (IBAN жив
 * на Business). **Після Sprint 9** — root-вивіска зі списком рахунків, у якій
 * клієнт обирає, через який IBAN робити переказ; QR живе глибше — на
 * per-account-вивісці `pay.finly.com.ua/{businessSlug}/{accountSlug}`.
 *
 * **Branching живе у Server Component** (`host-pay/[slug]/page.tsx`):
 *  - `accounts.length === 0` → render empty-state нижче ("Власник ще не
 *    налаштував рахунки").
 *  - `accounts.length === 1` → Next.js `redirect(307)` на
 *    `/{businessSlug}/{accountSlug}` (відбувається в Server Component, цей view
 *    не отримує 1-Account-payload).
 *  - `accounts.length >= 2` → render list-of-cards.
 *
 * Чому 307 (а не 308) — `accounts.length === 1` стан **умовно** (ФОП додасть
 * 2-й рахунок → редірект перестане бути коректним). Chrome агресивно кешує 308
 * in-memory навіть з `Cache-Control: no-cache`. Деталі — README §SP-4.
 *
 * **Null-bankCode UI-rule (§SP-9):** на `bankCode === null` bank-label-row
 * ховається повністю — без fallback-у на "Невідомий банк". Symmetric до
 * cabinet `AccountsSection` cards (`features/business-edit/AccountsSection.tsx`).
 */
export default function PublicBusinessView({
    type: _type,
    name,
    slug,
    accounts,
    apiBase = '/api',
}: Props) {
    if (accounts.length === 0) {
        return <EmptyState name={name} />;
    }

    const heading = `Платіж на користь ${name}`;
    const qrSrc = `${apiBase}/businesses/public/${encodeURIComponent(slug)}/qr/business.png`;
    return (
        <div className="mx-auto max-w-xl space-y-8 px-4 py-8">
            <header className="space-y-2 text-center">
                <h1 className="text-foreground text-2xl font-bold tracking-tight md:text-3xl">
                    {heading}
                </h1>
                <p className="text-muted-foreground text-sm">
                    Оберіть рахунок для оплати
                </p>
            </header>

            <ul className="space-y-3">
                {accounts.map((account) => (
                    <li key={account.slug}>
                        <AccountCard businessSlug={slug} account={account} />
                    </li>
                ))}
            </ul>

            <figure className="space-y-2 text-center">
                <UiQrImage
                    src={qrSrc}
                    alt="QR на цю сторінку"
                    className="border-border mx-auto w-full max-w-[240px] rounded-md border bg-white"
                />
                <figcaption className="text-muted-foreground text-sm">
                    QR на цю сторінку — для вивіски чи поширення
                </figcaption>
            </figure>
        </div>
    );
}

function AccountCard({
    businessSlug,
    account,
}: {
    businessSlug: string;
    account: PublicAccountListItem;
}) {
    const href = `/${encodeURIComponent(businessSlug)}/${encodeURIComponent(account.slug)}`;
    // §SP-9 null-fallback rule — bank-label рендериться лише на non-null
    // bankCode; ibanMask завжди показуємо як disambiguator. Заголовок: власна
    // name або банк-лейбл (на нерозпізнаному банку — сама маска). Окремі bank-/
    // mask-рядки нижче — лише коли не дублюють заголовок (та сама розкладка, що
    // cabinet AccountCard).
    const mask = account.ibanMask;
    const title =
        account.name ??
        (account.bankCode !== null ? BANK_LABEL[account.bankCode] : mask);
    const showMask = title !== mask;
    // Pattern symmetric Sprint 9 §9.2 cabinet `features/business-edit/
    // AccountsSection > AccountCard`: card — звичайний `<div>`-контейнер,
    // navigation інкапсульована у `UiButton as="link"` всередині (повна
    // ширина, повноцінний CTA). Raw `<a href>` на цілу картку був би
    // порушенням `docs/conventions/ui-primitives.md` §1 (UiButton як єдина
    // точка стилізації для всіх інтерактивних посилань). UiButton-only
    // також сидрить single-anchor-per-tap UX (mobile: уся ширина CTA —
    // комфортна tap-target).
    return (
        <div className="border-border bg-card flex flex-col gap-4 rounded-lg border p-5">
            <div className="flex min-w-0 flex-col gap-1">
                <span className="text-foreground truncate text-xl font-semibold tracking-tight">
                    {title}
                </span>
                {account.name !== null && account.bankCode !== null && (
                    <span className="text-muted-foreground truncate text-base">
                        {BANK_LABEL[account.bankCode]}
                    </span>
                )}
                {showMask && (
                    <span className="text-muted-foreground font-mono text-base">
                        {mask}
                    </span>
                )}
            </div>
            <UiButton
                as="link"
                href={href}
                variant="filled"
                size="md"
                IconRight={<ArrowRight />}
                className="w-full justify-center"
            >
                Сплатити
            </UiButton>
        </div>
    );
}

function EmptyState({ name }: { name: string }) {
    return (
        <div className="mx-auto max-w-xl px-4 py-16 text-center">
            <h1 className="text-foreground text-2xl font-bold tracking-tight md:text-3xl">
                Платіж на користь {name}
            </h1>
            <p className="text-muted-foreground mt-4 text-sm">
                Власник ще не налаштував жодного рахунку для прийому платежів.
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
                Зверніться до отримувача за реквізитами.
            </p>
        </div>
    );
}
