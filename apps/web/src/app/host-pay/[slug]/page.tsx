import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { BUSINESS_TYPE_LABEL } from '@finly/types';
import {
    PublicBusinessView,
    loadPublicView,
} from '@/features/business-public';
import { isPublicHost } from '@/shared/config/publicHosts';

/**
 * Sprint 3 §3.9 — публічна вивіска бізнесу `pay.finly.com.ua/{slug}`.
 *
 * **Internal URL-сегмент `host-pay/`** під middleware-rewrite-ом
 * (`apps/web/src/middleware.ts`). Direct-access на cabinet host
 * (`finly.com.ua/host-pay/{slug}`) блокується middleware Branch C → 404.
 * Defense-in-depth: page-handler сам перевіряє host через `headers()` і
 * робить `notFound()` якщо middleware-config зломається (наприклад, hot-reload
 * у dev переписав middleware, а page ще не перерендерився).
 *
 * **Sprint plan §3.1 §E1 — case-preserved slug + canonical 301 redirect.**
 * Backend lookup case-insensitive (`slugLower`), повертає бізнес з
 * canonical-case `slug`. Якщо URL-input відрізняється від canonical —
 * `permanentRedirect` на правильну форму. QR-картинка завжди генерується
 * з canonical slug — скан не викликає redirect-hop.
 *
 * **ISR `revalidate: 60`** (Sprint 3 §F4) — баланс між швидкістю оновлення
 * (зміни ФОП-а видно клієнтам до хвилини) і навантаженням на API.
 */

export const revalidate = 60;

interface Props {
    params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug } = await params;
    const view = await loadPublicView(slug);
    if (!view) {
        return {
            title: 'Сторінку не знайдено — Finly',
            robots: { index: false, follow: false },
        };
    }
    const heading = `${BUSINESS_TYPE_LABEL[view.type]} ${view.name}`;
    return {
        title: `Оплата на ${heading} — Finly`,
        description: `Сторінка для оплати на ${heading}. Оберіть банк і завершіть платіж у мобільному додатку.`,
        // Sprint 3 рішення E3 — `noindex` за замовчуванням, ФОП opt-in
        // через toggle `seoIndexEnabled` у кабінеті.
        robots: view.seoIndexEnabled
            ? { index: true, follow: true }
            : { index: false, follow: false },
    };
}

export default async function HostPayPage({ params }: Props) {
    // Defense-in-depth host check — middleware має направляти сюди тільки
    // запити з `pay.finly.com.ua`/`pay.finly.local:3000`. Якщо middleware
    // зломається (hot-reload race / config drift) — Server Component
    // відмовиться рендерити на cabinet host через стандартний 404.
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

    // Canonical-case redirect (Sprint 3 §E1). `view.slug` — case-preserved,
    // як зберіг ФОП. Якщо URL-input не співпадає посимвольно — 301 на
    // канонічну форму. `permanentRedirect` тут безпечний (Server Component
    // підтримує його), кеш браузера й search-engines оновлять index.
    if (slug !== view.slug) {
        permanentRedirect(`/${view.slug}`);
    }

    return (
        <PublicBusinessView
            type={view.type}
            name={view.name}
            slug={view.slug}
            acceptedBanks={view.acceptedBanks}
            nbuLinks={view.nbuLinks}
        />
    );
}
