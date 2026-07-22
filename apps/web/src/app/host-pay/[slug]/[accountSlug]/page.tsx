import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { BANK_LABEL, BUSINESS_TYPE_LABEL, PURPOSE_MARKERS } from '@finly/types';
import {
    PersonalizedPayment,
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
    /** Next завжди передає; опційний заради сумісності зі старими викликами. */
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Серіалізує query назад у рядок для canonical-redirect: `?a=1&b=2` або порожній
 * рядок. Значення-масиви (повторені ключі) зберігаються повторенням ключа.
 */
function buildQueryString(
    query: Record<string, string | string[] | undefined> | undefined
): string {
    if (!query) return '';
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
            for (const item of value) params.append(key, item);
        } else {
            params.append(key, value);
        }
    }
    const serialized = params.toString();
    return serialized.length > 0 ? `?${serialized}` : '';
}

export async function generateMetadata({
    params,
    searchParams,
}: Props): Promise<Metadata> {
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
    // Sprint 29 — персональна адреса (`?taxId=…&fullName=…`) містить персональні
    // дані платника, а сторінка сама пропонує її переслати. Canonical лише
    // підказка: адресу з зовнішнім посиланням пошук індексує і з параметрами,
    // тож персоналізований варіант віддаємо строго noindex. Гола адреса
    // індексується як і раніше.
    const query = (await searchParams) ?? {};
    const isPersonalized = PURPOSE_MARKERS.some(
        (marker) => query[marker] !== undefined
    );
    return {
        ...buildMetadata({
            title,
            description,
            canonicalUrl,
        }),
        robots:
            view.business.seoIndexEnabled && !isPersonalized
                ? { index: true, follow: true }
                : { index: false, follow: false },
    };
}

export default async function HostPayAccountPage({
    params,
    searchParams,
}: Props) {
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
        // Sprint 29 — query переносимо разом із шляхом. Персональне посилання
        // (`?taxId=…&period=…`) шерабельне за задумом, а потрапити на
        // неканонічний slug легко: business-slug шукається без урахування
        // регістру, account-slug має 90-денний history-fallback (адмін завів нові
        // державні реквізити і перейменував старі). Голий redirect віддавав би
        // платнику порожню форму замість передзаповненої.
        permanentRedirect(
            `/${view.business.slug}/${view.slug}${buildQueryString(await searchParams)}`
        );
    }

    // Sprint 29 — податковий (системний) отримувач із маркерами: інтерактивна
    // форма персоналізації замість готового QR.
    if (view.personalizationMarkers.length > 0) {
        return (
            <PersonalizedPayment
                businessSlug={view.business.slug}
                account={{
                    slug: view.slug,
                    name: view.name,
                    bankCode: view.bankCode,
                    ibanMask: view.ibanMask,
                }}
                business={view.business}
                markers={view.personalizationMarkers}
            />
        );
    }

    // Звичайний рахунок: nbuLinks гарантовано non-null (сервер рахує наперед).
    if (!view.nbuLinks) {
        notFound();
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
