import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { BANK_LABEL, BUSINESS_TYPE_LABEL } from '@finly/types';
import {
    PublicAccountView,
    loadPublicAccountView,
} from '@/features/account-public';
import { ENV } from '@/shared/config/env';
import { isPublicHost } from '@/shared/config/publicHosts';
import { buildMetadata } from '@/shared/seo/metadata';

/**
 * Sprint 9 §SP-4 — публічна per-account вивіска
 * `pay.finly.com.ua/{businessSlug}/{accountSlug}`.
 *
 * **Internal route `/host-pay/[slug]/[accountSlug]/`** під middleware-rewrite-
 * ом (Branch A2, `apps/web/src/middleware.ts`). Direct-access на cabinet host
 * блокується middleware Branch C → 404. Defense-in-depth: page-handler сам
 * перевіряє host через `headers()`.
 *
 * **Canonical-redirect лише для business-slug** (Sprint 3 рішення E1):
 * business-slug case-insensitive lookup → 308 на canonical-case. Account-slug
 * case-sensitive (Sprint 9 §SP-10) — exact-match-or-404, без redirect.
 *
 * **`dynamic = 'force-dynamic'`** — account-vanity-view зазвичай стабільна,
 * але правки name/preset мають бути видимі клієнту негайно. Без ISR-кешу
 * cabinet→public consistency-вимога виконується кожен hit. CDN-relief через
 * ETag, не через time-based кеш.
 */

export const dynamic = 'force-dynamic';

interface Props {
    params: Promise<{ slug: string; accountSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const headerList = await headers();
    if (!isPublicHost(headerList.get('host'))) {
        return {
            title: 'Сторінку не знайдено | Finly',
            robots: { index: false, follow: false },
        };
    }
    const { slug, accountSlug } = await params;
    const view = await loadPublicAccountView(slug, accountSlug);
    if (!view) {
        return {
            title: 'Сторінку не знайдено | Finly',
            robots: { index: false, follow: false },
        };
    }
    // Sprint 7 §SP-5 — SEO `<title>` type-aware (h1 нейтральний).
    // Account-вивіска: business-context + account-name + bank-label-маркер.
    const businessLabel = `${BUSINESS_TYPE_LABEL[view.business.type]} ${view.business.name}`;
    const bankLabel =
        view.bankCode !== null ? `${BANK_LABEL[view.bankCode]} ` : '';
    const title = `Оплата на ${businessLabel} (${bankLabel}${view.ibanMask}) | Finly`;
    const description = `Сторінка для оплати на ${businessLabel}. Оберіть банк і завершіть платіж у мобільному додатку.`;
    const canonicalUrl = `${ENV.NEXT_PUBLIC_PAY_PUBLIC_URL.replace(/\/$/, '')}/${view.business.slug}/${view.slug}`;
    return {
        ...buildMetadata({
            title,
            description,
            canonicalUrl,
        }),
        robots: view.business.seoIndexEnabled
            ? { index: true, follow: true }
            : { index: false, follow: false },
    };
}

export default async function HostPayAccountPage({ params }: Props) {
    // Defense-in-depth host check — middleware має направляти сюди тільки
    // запити з `pay.finly.com.ua`. Якщо middleware зломається (hot-reload
    // race / config drift) — Server Component відмовиться рендерити на
    // cabinet host через стандартний 404.
    const headerList = await headers();
    const host = headerList.get('host');
    if (!isPublicHost(host)) {
        notFound();
    }

    const { slug, accountSlug } = await params;
    const view = await loadPublicAccountView(slug, accountSlug);
    if (!view) {
        notFound();
    }

    // Sprint 15 — canonical-redirect на обох сегментах. business-slug
    // (case-insensitive) і account-slug (редаговуваний vanity, history-fallback
    // на backend) можуть бути застарілими у збереженому посиланні; будуємо
    // повний canonical URL і робимо один permanent redirect, якщо хоч один
    // сегмент відрізняється від поточного.
    if (slug !== view.business.slug || accountSlug !== view.slug) {
        permanentRedirect(`/${view.business.slug}/${view.slug}`);
    }

    return (
        <PublicAccountView
            account={{
                slug: view.slug,
                name: view.name,
                bankCode: view.bankCode,
                ibanMask: view.ibanMask,
            }}
            business={view.business}
            nbuLinks={view.nbuLinks}
        />
    );
}
