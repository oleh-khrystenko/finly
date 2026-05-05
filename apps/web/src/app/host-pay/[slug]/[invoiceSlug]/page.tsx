import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { BUSINESS_TYPE_LABEL } from '@finly/types';
import {
    InvoicePublicView,
    loadPublicInvoiceView,
} from '@/features/invoice-public';
import { isPublicHost } from '@/shared/config/publicHosts';
import { formatKopecksAsHryvnia } from '@/features/invoices/formatKopecks';

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
 * **ISR `revalidate: 60`** — той самий, що Sprint 3.
 */

export const revalidate = 60;

interface Props {
    params: Promise<{ slug: string; invoiceSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug, invoiceSlug } = await params;
    const view = await loadPublicInvoiceView(slug, invoiceSlug);
    if (!view) {
        return {
            title: 'Рахунок не знайдено — Finly',
            robots: { index: false, follow: false },
        };
    }
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

    // Expired-status sanity-block (validUntil < now) рендериться всередині
    // `InvoicePublicView` — заміщає payment-flow на банер. Server Component
    // тут не вирішує — пропускаємо view-state-decision у presentation layer.

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
