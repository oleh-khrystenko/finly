import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';

import UiButton from '@/shared/ui/UiButton';
import UiQrImage from '@/shared/ui/UiQrImage';
import { ENV } from '@/shared/config/env';
import { isPublicHost } from '@/shared/config/publicHosts';

/**
 * Пояснювач на голому корені public payment-host-а (`pay.finly.com.ua/`).
 *
 * Middleware (`proxy.ts` Branch A0) rewrite-ить pay-host `/` сюди. Голий корінь —
 * це випадковий або обрізаний візит: платник загубив повне посилання
 * `pay.finly.com.ua/{businessSlug}`. Замість 404-dead-end показуємо контекст
 * "що це за хост" + куди йти.
 *
 * **Defense-in-depth host-check** через `headers()` — як у сусідніх host-pay
 * page-handler-ах. Якщо запит дійшов з cabinet host (Branch C мав би 404-ити
 * direct `/host-pay`) — Server Component відмовиться рендерити через 404.
 *
 * Бренд-хедер/футер додає `app/host-pay/layout.tsx`.
 */

export async function generateMetadata(): Promise<Metadata> {
    const headerList = await headers();
    if (!isPublicHost(headerList.get('host'))) {
        return {
            title: 'Сторінку не знайдено — Finly',
            robots: { index: false, follow: false },
        };
    }
    return {
        title: 'Платіжні сторінки — Finly',
        description:
            'Кожен підприємець має на Finly власну сторінку для оплати. Відкрийте повне посилання, яке вам надіслали.',
        // Утилітарний корінь хоста — не індексуємо (щоб не конкурувати з
        // marketing-лендінгом), але дозволяємо краулеру піти за CTA.
        robots: { index: false, follow: true },
    };
}

export default async function HostPayRootPage() {
    const headerList = await headers();
    if (!isPublicHost(headerList.get('host'))) {
        notFound();
    }

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
                <span className="text-muted-foreground">назва-бізнесу</span>
            </p>

            <p className="text-muted-foreground mt-6 text-sm leading-relaxed">
                Маєте лише домен? Попросіть в отримувача повне посилання або
                його QR-код для оплати.
            </p>

            {/* «Відкрий Finly» — QR і кнопка згруповані в одну дію: скануй з
                іншого пристрою або тисни тут. QR — наш брендований код на
                головний сайт (догфудимо власний продукт). */}
            <div className="border-border bg-card mt-10 w-full rounded-xl border p-6">
                <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-6 sm:text-left">
                    <div className="border-border w-36 shrink-0 rounded-lg border bg-white p-2">
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
