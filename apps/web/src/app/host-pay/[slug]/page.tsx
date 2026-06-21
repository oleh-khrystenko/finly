import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { BUSINESS_TYPE_LABEL } from '@finly/types';
import { PublicBusinessView, loadPublicView } from '@/features/business-public';
import { ENV } from '@/shared/config/env';
import { isPublicHost } from '@/shared/config/publicHosts';
import { buildMetadata } from '@/shared/seo/metadata';

/**
 * Sprint 3 §3.9 + Sprint 9 §SP-4 — публічна root-вивіска бізнесу
 * `pay.finly.com.ua/{businessSlug}`.
 *
 * **Sprint 9 §SP-4 — 0/1/2+ branching на `accounts.length`:**
 *  - `0` → render empty-state (через `PublicBusinessView`-component).
 *  - `1` → `redirect('/{businessSlug}/{accountSlug}')` (Next.js helper, що
 *    віддає **HTTP 307 Temporary Redirect**, НЕ `permanentRedirect`/308 —
 *    стан "1 Account" умовний, ФОП може додати 2-й рахунок).
 *  - `>= 2` → render list-of-cards (через `PublicBusinessView`).
 *
 * **Чому 307, а не 308**: Chrome агресивно кешує 308 in-memory навіть з
 * `Cache-Control: no-cache`. Після додавання 2-го рахунку клієнт, який
 * у тій самій сесії відкрив URL коли був 1 Account, застрягне на старій
 * per-account-вивісці. 307 не має такої агресивної in-memory-фіксації.
 * Деталі — README §SP-4.
 *
 * **`force-dynamic`** — без ISR / route-cache, бо `redirect()` вище кешується
 * як частина page-output-у; Next.js cache + 1-Account snapshot створить
 * stale 307-redirect навіть після того, як ФОП додав 2-й рахунок. UAT ACC-2
 * явно перевіряє цей сценарій. Edge-level CDN cache contolled через
 * `Cache-Control: no-store` що middleware Branch A1 ставить.
 *
 * **Defense-in-depth host-check** через `headers()` — middleware має
 * направляти сюди тільки запити з `pay.finly.com.ua`/`pay.finly.local:3000`.
 * Якщо middleware зломається (hot-reload race / config drift) — page відмовиться
 * рендерити на cabinet host через стандартний 404.
 *
 * **Sprint plan §3.1 §E1 — case-preserved slug + canonical 308 redirect.**
 * Якщо URL-input відрізняється від canonical slug — `permanentRedirect` на
 * правильну форму (HTTP 308). Виконується ПЕРЕД 0/1/2+ branching, щоб
 * редірект попав на canonical-форму без stale-state-проблем.
 */

export const dynamic = 'force-dynamic';

interface Props {
    params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    // Defense-in-depth host-check — guard від cabinet-host metadata-leak.
    // Без guard-а тут `generateMetadata` обходить host-isolation на metadata-
    // stage: cabinet host, що випадково потрапив у Next.js route-resolver,
    // fetch-ив би public-business-view і формував би metadata по чужому
    // контуру. Page handler потім робить 404, але metadata-fetch уже стався.
    const headerList = await headers();
    if (!isPublicHost(headerList.get('host'))) {
        return {
            title: 'Сторінку не знайдено — Finly',
            robots: { index: false, follow: false },
        };
    }
    const { slug } = await params;
    const view = await loadPublicView(slug);
    if (!view) {
        return {
            title: 'Сторінку не знайдено — Finly',
            robots: { index: false, follow: false },
        };
    }
    // Sprint 7 §SP-5 + §7.9 — SEO `<title>` навмисно type-aware (на відміну
    // від h1). H1 уніфікований до нейтрального формулювання, meta-tag тримає
    // type-key-word-у для пошукової видачі ("Оплата на ФОП Іваненко — Finly").
    const heading = `${BUSINESS_TYPE_LABEL[view.type]} ${view.name}`;
    const title = `Оплата на ${heading} — Finly`;
    const description = `Сторінка для оплати на ${heading}. Оберіть рахунок і завершіть платіж у мобільному додатку.`;
    const canonicalUrl = `${ENV.NEXT_PUBLIC_PAY_PUBLIC_URL.replace(/\/$/, '')}/${view.slug}`;
    return {
        ...buildMetadata({
            title,
            description,
            canonicalUrl,
        }),
        // Sprint 3 рішення E3 — `noindex` за замовчуванням, ФОП opt-in
        // через toggle `seoIndexEnabled` у кабінеті.
        robots: view.seoIndexEnabled
            ? { index: true, follow: true }
            : { index: false, follow: false },
    };
}

export default async function HostPayPage({ params }: Props) {
    const headerList = await headers();
    const host = headerList.get('host');
    if (!isPublicHost(host)) {
        notFound();
    }

    const { slug } = await params;
    const view = await loadPublicView(slug);
    if (!view) {
        notFound();
    }

    // Canonical-case redirect (Sprint 3 §E1). Виконується ПЕРЕД 0/1/2+
    // branching: redirect на canonical-форму стабілізує URL до того як
    // включається account-driven логіка.
    if (slug !== view.slug) {
        permanentRedirect(`/${view.slug}`);
    }

    // Sprint 9 §SP-4 — 1-Account → 307 Temporary Redirect на per-account
    // вивіску. `redirect()` (НЕ `permanentRedirect`/308) — стан умовний.
    if (view.accounts.length === 1) {
        const onlyAccount = view.accounts[0]!;
        redirect(`/${view.slug}/${onlyAccount.slug}`);
    }

    // 0 → empty-state; >= 2 → list-view (обидва живуть у `PublicBusinessView`).
    return (
        <PublicBusinessView
            type={view.type}
            name={view.name}
            slug={view.slug}
            logo={view.logo}
            brandDisplayName={view.brandDisplayName}
            accounts={view.accounts}
        />
    );
}
