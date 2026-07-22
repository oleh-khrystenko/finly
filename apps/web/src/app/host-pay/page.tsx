import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';

import UiButton from '@/shared/ui/UiButton';
import UiQrImage from '@/shared/ui/UiQrImage';
import { ENV } from '@/shared/config/env';
import { isPublicHost } from '@/shared/config/publicHosts';
import { buildMetadata } from '@/shared/seo/metadata';
import { PublicCatalog, loadCatalogSafe } from '@/features/catalog';

/**
 * Sprint 29 — головна pay-хоста (`pay.finly.com.ua/`) стала публічним каталогом
 * перевірених отримувачів. Middleware (`proxy.ts` Branch A0) rewrite-ить pay-host
 * `/` сюди. Це перший індексований контент pay-хоста.
 *
 * Порожній каталог → пояснювач для випадкового/обрізаного візиту (платник
 * загубив повне посилання `pay.finly.com.ua/{slug}`), щоб не було dead-end.
 *
 * **Defense-in-depth host-check** через `headers()` — як у сусідніх host-pay
 * page-handler-ах: запит з cabinet host відмовляється рендеритись (404).
 */

const CANONICAL_URL = ENV.NEXT_PUBLIC_PAY_PUBLIC_URL.replace(/\/$/, '');

export async function generateMetadata(): Promise<Metadata> {
    const headerList = await headers();
    if (!isPublicHost(headerList.get('host'))) {
        return {
            title: 'Сторінку не знайдено | Finly',
            robots: { index: false, follow: false },
        };
    }
    // Порожній каталог (у т.ч. через недоступний API) рендерить пояснювач, а не
    // каталог. Індексувати його під keyword-rich заголовком не можна: у видачу
    // осіла б тонка сторінка «Це хост платіжних сторінок Finly». `loadCatalogSafe`
    // мемоїзований React-`cache`, тож page-handler нижче бачить той самий стан
    // без другого запиту.
    const catalog = await loadCatalogSafe();
    if (catalog.sections.length === 0) {
        return {
            ...buildMetadata({
                title: 'Платіжні сторінки Finly',
                description:
                    'Хост платіжних сторінок Finly: відкрийте повне посилання, яке вам надіслали.',
                canonicalUrl: CANONICAL_URL,
            }),
            robots: { index: false, follow: true },
        };
    }

    return {
        ...buildMetadata({
            title: 'Оплата податків, зборів і внесків онлайн | Finly',
            description:
                'Каталог перевірених отримувачів: податкова, фонди, благодійність. Оберіть отримувача і платіть за QR-кодом НБУ у своєму банку.',
            canonicalUrl: CANONICAL_URL,
        }),
        robots: { index: true, follow: true },
    };
}

export default async function HostPayRootPage() {
    const headerList = await headers();
    if (!isPublicHost(headerList.get('host'))) {
        notFound();
    }

    // Недоступний API не кладе корінь у помилку: порожній каталог падає на той
    // самий пояснювач (`loadCatalogSafe`).
    const catalog = await loadCatalogSafe();
    if (catalog.sections.length === 0) {
        return <EmptyHostExplainer />;
    }
    return <PublicCatalog catalog={catalog} />;
}

/**
 * Порожній каталог: пояснювач «що це за хост» + куди йти. Той самий контент, що
 * до Sprint 29 показувався завжди на голому корені.
 */
function EmptyHostExplainer() {
    return (
        <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center">
            <h1 className="text-foreground text-2xl font-bold tracking-tight md:text-3xl">
                Це хост платіжних сторінок Finly
            </h1>

            <p className="text-muted-foreground mt-4 text-base leading-relaxed">
                Кожен підприємець має тут власну сторінку для оплати. Посилання
                має вигляд:
            </p>

            <p className="border-border bg-card text-foreground mt-4 rounded-lg border px-4 py-2.5 font-mono text-sm">
                pay.finly.com.ua/
                <span className="text-muted-foreground">назва-отримувача</span>
            </p>

            <p className="text-muted-foreground mt-6 text-sm leading-relaxed">
                Маєте лише домен? Попросіть в отримувача повне посилання або
                його QR-код для оплати.
            </p>

            <div className="border-border bg-card mt-10 w-full rounded-xl border p-6">
                <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-6 sm:text-left">
                    <div className="border-border w-full shrink-0 rounded-lg border bg-white p-2 sm:w-36">
                        <UiQrImage
                            src="/api/qr/landing.png"
                            alt="QR-код на сайт Finly"
                            className="rounded"
                        />
                    </div>
                    <div className="flex flex-col items-center gap-3 sm:items-start">
                        <div className="space-y-1">
                            <p className="text-foreground font-medium">
                                Дізнайтеся більше про Finly
                            </p>
                            <p className="text-muted-foreground text-sm">
                                Скануйте QR або відкрийте сайт у браузері.
                            </p>
                        </div>
                        <UiButton
                            as="a"
                            href={ENV.NEXT_PUBLIC_BASE_URL}
                            variant="filled"
                            size="md"
                            IconRight={<ArrowRight />}
                        >
                            Відкрити finly.com.ua
                        </UiButton>
                    </div>
                </div>
            </div>
        </div>
    );
}
