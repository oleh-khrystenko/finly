import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { BUSINESS_TYPE_LABEL } from '@finly/types';
import { PublicBusinessView, loadPublicView } from '@/features/business-public';
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
 * **Sprint plan §3.1 §E1 — case-preserved slug + canonical 308 redirect.**
 * Backend lookup case-insensitive (`slugLower`), повертає бізнес з
 * canonical-case `slug`. Якщо URL-input відрізняється від canonical —
 * `permanentRedirect` на правильну форму (Next.js повертає HTTP 308
 * Permanent Redirect — зберігає метод і тіло, на відміну від 301).
 * QR-картинка завжди генерується з canonical slug — скан не викликає
 * redirect-hop.
 *
 * **ISR `revalidate: 60`** (Sprint 3 §F4) — баланс між швидкістю оновлення
 * (зміни ФОП-а видно клієнтам до хвилини) і навантаженням на API.
 */

export const revalidate = 60;

interface Props {
    params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    // Defense-in-depth host-check (review fix) — той самий patern, що
    // page-handler нижче. Без guard-а тут `generateMetadata` обходить host-
    // isolation на metadata-stage: cabinet host, що випадково потрапив у
    // Next.js route-resolver, fetch-ив би public-business-view і формував
    // би metadata по чужому контуру. Page handler потім робить 404, але
    // metadata-fetch уже стався.
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
    // Sprint 7 §SP-5 + §7.9 — SEO `<title>` навмисно **type-aware**, на
    // відміну від h1. Sprint 7 README:167 та §SP-5 явно фіксують: type-aware
    // зберігається саме для `<title>` (для пошукової видачі — `'Оплата на
    // ФОП Іваненко — Finly'` тощо). H1 на сторінці робить нейтральне
    // формулювання ("Платіж на користь {name}") для UX-причин, але SEO meta
    // — інший контекст: search-engine-snippet виграє від type-key-word-у
    // ("ФОП", "ТОВ") поряд з назвою. Дублювання для типу, де назва вже
    // містить юр-форму, прийнятне (Sprint 7 §SP-5 explicit trade-off).
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
    // як зберіг ФОП. Якщо URL-input не співпадає посимвольно — 308 на
    // канонічну форму (Next.js `permanentRedirect` → HTTP 308). Кеш
    // браузера й search-engines оновлять index без зміни методу.
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
