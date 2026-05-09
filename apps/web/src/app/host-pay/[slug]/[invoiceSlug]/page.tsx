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
 * Sprint 4 §4.7 — публічна сторінка інвойсу
 * `pay.finly.com.ua/{businessSlug}/{invoiceSlug}`.
 *
 * **Internal route `/host-pay/[slug]/[invoiceSlug]/`** під middleware-rewrite-
 * ом (Branch A2, `apps/web/src/middleware.ts`). Direct-access на cabinet host
 * блокується middleware Branch C → 404. Defense-in-depth: page-handler
 * сам перевіряє host через `headers()`.
 *
 * **Canonical-redirect лише для business-slug.** Sprint 3 рішення E1: business-
 * slug case-insensitive lookup → 308 на canonical-case. Invoice-slug
 * case-sensitive (Sprint 4 §SP-8) — exact-match-or-404, без redirect.
 *
 * **`noindex` для всіх invoice-сторінок** (Sprint 4 §4.7): на відміну від
 * бізнесу, інвойси завжди out-of-search (одноразові, часто містять чутливу
 * інформацію у purpose). `seoIndexEnabled` toggle для інвойсу свідомо
 * відсутній.
 *
 * **`dynamic = 'force-dynamic'`** (Sprint 4 review fix) — invoice mutable
 * payment data, ISR-кеш робив shipped fix-ив stale view: видалений рахунок
 * ще видно клієнту після `cache: 'no-store'` на API-fetch не міг "пробити"
 * Next ISR-snapshot. Force-dynamic примушує SSR на кожний request — це
 * правильна модель для invoice-page (на відміну від business-page, що
 * залишається ISR-кеш-friendly).
 */

export const dynamic = 'force-dynamic';

interface Props {
    params: Promise<{ slug: string; invoiceSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    // Defense-in-depth host-check (review fix). Page handler нижче робить
    // ту саму перевірку перед fetch, але `generateMetadata` — окрема
    // SSR-stage функція з власним call-graph-ом. Без host-guard-а тут
    // cabinet host (`finly.com.ua/host-pay/...`), що випадково потрапив
    // у Next.js route-resolver через middleware-bypass / hot-reload race,
    // тихо викликав би `loadPublicInvoiceView` і fetch-ив би invoice-data
    // на cabinet-зоні. Page handler потім зробив би 404, але data leak у
    // metadata-stage уже стався.
    const headerList = await headers();
    if (!isPublicHost(headerList.get('host'))) {
        return {
            title: 'Сторінку не знайдено — Finly',
            robots: { index: false, follow: false },
        };
    }
    const { slug, invoiceSlug } = await params;
    const view = await loadPublicInvoiceView(slug, invoiceSlug);
    if (!view) {
        return {
            title: 'Рахунок не знайдено — Finly',
            robots: { index: false, follow: false },
        };
    }
    // Sprint 4 §4.7 + Sprint 7 §SP-5 — invoice title узгоджений з actual
    // `InvoicePublicView` UI:
    //  - h1 нейтральний від Sprint 4 (`Рахунок на 1 500,00 ₴` / `Рахунок на
    //    оплату`) — type-незалежний з рождення.
    //  - sub-heading під h1 (`InvoicePublicView.tsx:101`) показує одержувача
    //    type-aware: `{BUSINESS_TYPE_LABEL[business.type]} {business.name}`.
    //
    // SEO meta `<title>` об'єднує обидві частини: amount-line + business-line.
    // Type-префікс одержувача узгоджений з UI-render-ом і з §SP-5 рішенням
    // (type-aware зберігається саме для metadata, не h1).
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
    // Defense-in-depth host check (той самий що `host-pay/[slug]/page.tsx`).
    const headerList = await headers();
    const host = headerList.get('host');
    if (!isPublicHost(host)) {
        notFound();
    }

    const { slug, invoiceSlug } = await params;
    const view = await loadPublicInvoiceView(slug, invoiceSlug);
    if (!view) {
        notFound();
    }

    // Canonical-redirect ТІЛЬКИ для business-slug (case-insensitive lookup).
    // Invoice-slug case-sensitive (SP-8): якщо `view.slug` !== `invoiceSlug` —
    // то backend повернув би 404 ще раніше (compound-unique exact-match), тож
    // тут перевірка не потрібна. Але defensive: якщо backend змінить
    // case-sensitivity у Phase 1.5+ — додаткова перевірка не зашкодить.
    if (slug !== view.business.slug) {
        permanentRedirect(`/${view.business.slug}/${invoiceSlug}`);
    }

    // Expired-block — server-driven (review fix): API ставить
    // `view.nbuLinks: null` коли `validUntil < now`, `InvoicePublicView`
    // рендерить банер "Термін рахунку минув" замість payment-flow. Server
    // Component тут просто прокидає payload — single source of truth для
    // expiry живе на API.

    return (
        <InvoicePublicView
            amount={view.amount}
            amountLocked={view.amountLocked}
            paymentPurpose={view.paymentPurpose}
            validUntil={view.validUntil}
            invoiceSlug={view.slug}
            business={view.business}
            nbuLinks={view.nbuLinks}
        />
    );
}
