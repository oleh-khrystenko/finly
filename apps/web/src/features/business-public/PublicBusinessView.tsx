import { ArrowRight, Landmark } from 'lucide-react';
import {
    BANK_LABEL,
    type BusinessType,
    type PublicAccountListItem,
} from '@finly/types';
import UiBankLogo from '@/shared/ui/UiBankLogo';
import UiBrandLogo from '@/shared/ui/UiBrandLogo';
import UiLink from '@/shared/ui/UiLink';
import { formatPayeeName } from '@/entities/business';

interface Props {
    /**
     * Юр-форма отримувача. Формує hero-назву через `formatPayeeName`
     * (ФОП/ТОВ — частина назви: «ФОП {ПІБ}» / «ТОВ {назва}»).
     */
    type: BusinessType;
    name: string;
    slug: string;
    /** Sprint 21 — кастомний бренд (присутній лише за активного бренду). */
    logo?: string;
    brandDisplayName?: string | null;
    /**
     * Sprint 9 §SP-4: server-side already відрізнив 0/1/2+ → цей view рендериться
     * тільки для `accounts.length === 0` (empty-state) або `>= 2` (list-of-cards).
     * 1-Account випадок резолвиться `redirect()` у Server Component перед render-ом.
     */
    accounts: PublicAccountListItem[];
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
 * **Картки реквізитів** — клікабельні рядки (вся картка = `UiLink` на сторінку
 * реквізитів) з логотипом банку (`UiBankLogo`), ієрархією назва/банк •номер
 * (symmetric до `UiPayeeCard`) і «Сплатити →» афордансом. **Null-bankCode
 * UI-rule (§SP-9):** на `bankCode === null`
 * банк-лейбл drop-ається (логотип → нейтральний плейсхолдер), без fallback-у
 * на "Невідомий банк"; маска лишається unconditional-disambiguator.
 */
export default function PublicBusinessView({
    type,
    name,
    slug,
    logo,
    brandDisplayName,
    accounts,
}: Props) {
    const payeeName = formatPayeeName(type, name);

    if (accounts.length === 0) {
        return (
            <EmptyState
                payeeName={payeeName}
                logo={logo}
                brandDisplayName={brandDisplayName}
            />
        );
    }

    return (
        <div className="mx-auto max-w-xl space-y-8 px-4 py-8">
            <header className="flex flex-col items-center gap-3 text-center">
                {logo && (
                    <UiBrandLogo
                        src={logo}
                        alt={brandDisplayName ?? payeeName}
                        displayName={brandDisplayName}
                    />
                )}
                <div className="space-y-1">
                    <p className="text-muted-foreground text-sm">Отримувач</p>
                    <h1 className="text-foreground text-2xl font-bold tracking-tight break-words md:text-3xl">
                        {payeeName}
                    </h1>
                    <p className="text-muted-foreground pt-1 text-sm">
                        Оберіть реквізити для оплати
                    </p>
                </div>
            </header>

            <ul className="space-y-3">
                {accounts.map((account) => (
                    <li key={account.slug}>
                        <AccountCard businessSlug={slug} account={account} />
                    </li>
                ))}
            </ul>
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
    const mask = account.ibanMask;
    const bankLabel =
        account.bankCode !== null ? BANK_LABEL[account.bankCode] : null;

    // Ієрархія реквізитів (symmetric до `UiPayeeCard`): осмислена власна назва
    // (не дублює банк-лейбл і не auto-default з маскою) — primary, а «банк
    // •номер» — вторинний рядок. Без назви «банк •номер» сам стає primary.
    // §SP-9: bank-лейбл drop-ається на null-bankCode; маска — unconditional.
    const customName =
        account.name !== null &&
        account.name !== bankLabel &&
        !account.name.includes(mask)
            ? account.name
            : null;
    // «банк •номер» одним рядком (маска — mono); єдине джерело «·» немає —
    // «•» біля номера вже візуально розділяє банк і рахунок.
    const bankAndMask = (
        <>
            {bankLabel ? `${bankLabel} ` : ''}
            <span className="font-mono">{mask}</span>
        </>
    );
    const primaryText =
        customName ?? (bankLabel ? `${bankLabel} ${mask}` : mask);

    // Уся картка — клікабельне посилання на сторінку реквізитів. `UiLink`
    // variant="unstyled" створений саме для card-links (візуал несе вкладений
    // контейнер) і не має хардкод-`position`, тож на відміну від `UiButton`
    // коректно віддає всю площу під клік. Видимий «Сплатити →» — афорданс дії;
    // декоративний (aria-hidden), бо назву посилання несе `aria-label`.
    return (
        <UiLink
            as="link"
            href={href}
            variant="unstyled"
            aria-label={`Перейти до оплати: ${primaryText}`}
            className="group border-border bg-card hover:border-primary/40 hover:bg-muted/40 flex items-center gap-4 rounded-xl border p-4 transition-colors"
        >
            {account.bankCode !== null ? (
                <UiBankLogo
                    bank={account.bankCode}
                    className="size-12 shrink-0"
                />
            ) : (
                <div
                    className="border-border bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-lg border"
                    aria-hidden
                >
                    <Landmark className="size-6" />
                </div>
            )}

            <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-base font-semibold">
                    {customName ?? bankAndMask}
                </p>
                {customName !== null && (
                    <p className="text-muted-foreground mt-0.5 truncate text-sm">
                        {bankAndMask}
                    </p>
                )}
            </div>

            <span
                className="text-primary inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold"
                aria-hidden
            >
                До оплати
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
        </UiLink>
    );
}

function EmptyState({
    payeeName,
    logo,
    brandDisplayName,
}: {
    payeeName: string;
    logo?: string;
    brandDisplayName?: string | null;
}) {
    return (
        <div className="mx-auto max-w-xl px-4 py-16 text-center">
            {logo && (
                <div className="mb-3 flex justify-center">
                    <UiBrandLogo
                        src={logo}
                        alt={brandDisplayName ?? payeeName}
                        displayName={brandDisplayName}
                    />
                </div>
            )}
            <p className="text-muted-foreground text-sm">Отримувач</p>
            <h1 className="text-foreground mt-1 text-2xl font-bold tracking-tight break-words md:text-3xl">
                {payeeName}
            </h1>
            <p className="text-muted-foreground mt-4 text-sm">
                Власник ще не налаштував реквізити для прийому платежів.
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
                Зверніться до отримувача за реквізитами.
            </p>
        </div>
    );
}
