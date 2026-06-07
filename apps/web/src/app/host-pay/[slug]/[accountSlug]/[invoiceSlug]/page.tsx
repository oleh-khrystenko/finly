import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { BUSINESS_TYPE_LABEL } from '@finly/types';
import {
    InvoicePublicView,
    loadPublicInvoiceView,
} from '@/features/invoice-public';
import { isPublicHost } from '@/shared/config/publicHosts';
import { formatKopecksAsHryvnia } from '@/entities/invoice';

/**
 * Sprint 4 §4.7 + Sprint 9 §SP-6 — публічна сторінка інвойсу
 * `pay.finly.com.ua/{businessSlug}/{accountSlug}/{invoiceSlug}` (3-сегментна).
 *
 * **Sprint 9 §SP-6** — інвойс переїхав під account-namespace (`(accountId, slug)`
 * compound-unique). URL став 3-сегментним; rewrite з public host обслуговує
 * middleware Branch A3.
 *
 * **Internal route `/host-pay/[slug]/[accountSlug]/[invoiceSlug]/`** під
 * middleware-rewrite. Direct-access на cabinet host блокується middleware
 * Branch C → 404. Defense-in-depth: page-handler сам перевіряє host.
 *
 * **Canonical-redirect на всіх трьох сегментах** (Sprint 15). business-slug
 * (case-insensitive), account-slug і invoice-slug — editable vanity з
 * history-fallback на backend; якщо хоч один сегмент застарілий, page будує
 * повний canonical URL і робить один permanent redirect.
 *
 * **`noindex` для всіх invoice-сторінок** (Sprint 4 §4.7): на відміну від
 * бізнесу та account-вивіски, інвойси завжди out-of-search (одноразові,
 * часто містять чутливу інформацію у purpose).
 *
 * **`dynamic = 'force-dynamic'`** (Sprint 4 review fix) — invoice mutable
 * payment data, ISR-кеш fix-ив stale view: видалений рахунок ще видно
 * клієнту після `cache: 'no-store'` на API-fetch не міг "пробити" Next
 * ISR-snapshot. Force-dynamic примушує SSR на кожний request.
 */

export const dynamic = 'force-dynamic';

interface Props {
    params: Promise<{
        slug: string;
        accountSlug: string;
        invoiceSlug: string;
    }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const headerList = await headers();
    if (!isPublicHost(headerList.get('host'))) {
        return {
            title: 'Сторінку не знайдено — Finly',
            robots: { index: false, follow: false },
        };
    }
    const { slug, accountSlug, invoiceSlug } = await params;
    const view = await loadPublicInvoiceView(slug, accountSlug, invoiceSlug);
    if (!view) {
        return {
            title: 'Рахунок не знайдено — Finly',
            robots: { index: false, follow: false },
        };
    }
    // Sprint 4 §4.7 + Sprint 7 §SP-5 — invoice title узгоджений з h1.
    // h1 нейтральний від Sprint 4 (`Рахунок на ...`); sub-heading під h1 —
    // type-aware (`{BUSINESS_TYPE_LABEL[business.type]} {business.name}`).
    // SEO `<title>` об'єднує amount-line + business-line.
    const businessLabel = `${BUSINESS_TYPE_LABEL[view.business.type]} ${view.business.name}`;
    const amountLabel = formatKopecksAsHryvnia(view.amount);
    const title = amountLabel
        ? `Рахунок на ${amountLabel} — ${businessLabel}`
        : `Рахунок на оплату — ${businessLabel}`;
    return {
        title: `${title} — Finly`,
        description: `Сторінка для оплати рахунку. Оберіть банк і завершіть платіж у мобільному додатку.`,
        // Sprint 4 §4.7 — invoices завжди noindex.
        robots: { index: false, follow: false },
    };
}

export default async function HostPayInvoicePage({ params }: Props) {
    const headerList = await headers();
    const host = headerList.get('host');
    if (!isPublicHost(host)) {
        notFound();
    }

    const { slug, accountSlug, invoiceSlug } = await params;
    const view = await loadPublicInvoiceView(slug, accountSlug, invoiceSlug);
    if (!view) {
        notFound();
    }

    // Sprint 15 — canonical-redirect на всіх трьох сегментах. business-slug
    // (case-insensitive), account-slug і invoice-slug (редаговувані vanity з
    // history-fallback на backend) можуть бути застарілими; будуємо повний
    // canonical URL і робимо один permanent redirect, якщо хоч один сегмент
    // відрізняється. Композиція history-fallback-ів лагодить і вкладені
    // посилання після rename рахунку.
    if (
        slug !== view.business.slug ||
        accountSlug !== view.account.slug ||
        invoiceSlug !== view.slug
    ) {
        permanentRedirect(
            `/${view.business.slug}/${view.account.slug}/${view.slug}`
        );
    }

    // Expired-block — server-driven (review fix): API ставить
    // `view.nbuLinks: null` коли `validUntil < now`, `InvoicePublicView`
    // рендерить банер "Термін рахунку минув" замість payment-flow. Single
    // source of truth для expiry живе на API.

    return (
        <InvoicePublicView
            amount={view.amount}
            paymentPurpose={view.paymentPurpose}
            validUntil={view.validUntil}
            invoiceSlug={view.slug}
            business={view.business}
            account={view.account}
            nbuLinks={view.nbuLinks}
        />
    );
}
