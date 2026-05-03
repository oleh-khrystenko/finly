'use client';

import {
    BANK_LABEL,
    BUSINESS_TYPE_LABEL,
    type BankCode,
    type BusinessType,
} from '@finly/types';

interface Props {
    type: BusinessType;
    name: string;
    slug: string;
    acceptedBanks: BankCode[];
    /**
     * NBU payload-link URLs (Sprint 3 рішення A2). Тап → ОС ловить через
     * app-link і відкриває банк-додаток з заповненими реквізитами.
     */
    nbuLinks: { primary: string; legacy: string };
    /** API endpoint origin для QR-картинок (`/api` для same-origin proxy). */
    apiBase?: string;
}

/**
 * Sprint 3 §3.9 — публічна вивіска бізнесу. Reusable у двох місцях:
 *   1. Phase 8 cabinet preview-toggle (B2 "Перегляд як клієнт").
 *   2. Host-aware route (Phase 9 — `app/host-pay/[slug]/page.tsx` через
 *      middleware-rewrite з `pay.finly.com.ua/{slug}`).
 *
 * Layout (E7 рішення):
 *   - Заголовок "Оплата на {Тип} {Назва}".
 *   - Сітка 11 generic bank-tile (B1: неактивні, grayscale, з підписом
 *     "Незабаром"). Sprint 5 розблокує per-bank deep-links.
 *   - 2 активні CTA з `nbuLinks.primary`/`.legacy` href — ОС handle через
 *     app-link, відкриває банк з реквізитами (рішення A2).
 *   - 2 QR-картинки на API endpoints (host=primary | legacy).
 */
export default function PublicBusinessView({
    type,
    name,
    slug,
    acceptedBanks,
    nbuLinks,
    apiBase = '/api',
}: Props) {
    const heading = `Оплата на ${BUSINESS_TYPE_LABEL[type]} ${name}`;

    const qrPrimary = `${apiBase}/businesses/public/${encodeURIComponent(slug)}/qr/nbu.png?host=primary`;
    const qrLegacy = `${apiBase}/businesses/public/${encodeURIComponent(slug)}/qr/nbu.png?host=legacy`;

    return (
        <div className="mx-auto max-w-xl space-y-8 px-4 py-8">
            <h1 className="text-foreground text-center text-2xl font-bold tracking-tight md:text-3xl">
                {heading}
            </h1>

            {/* 11 inactive bank tiles (B1). Generic stylized з ініціалом
                у крузі (B5 fallback — Sprint plan дозволяє generic, бренд-
                guidelines банків поза скоупом). Sprint 5 розблокує
                per-bank deep-links без зміни цього layout. */}
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {acceptedBanks.map((bank) => (
                    <div
                        key={bank}
                        aria-disabled
                        className="border-border bg-muted/30 text-muted-foreground flex h-20 cursor-not-allowed flex-col items-center justify-center gap-1.5 rounded-md border px-2 text-center opacity-70 grayscale"
                        title="Незабаром"
                    >
                        <div className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-full text-xs font-bold">
                            {BANK_LABEL[bank].slice(0, 1).toUpperCase()}
                        </div>
                        <span className="text-[10px] leading-tight">
                            {BANK_LABEL[bank]}
                        </span>
                    </div>
                ))}
            </div>

            {/* 2 active CTAs (A2 + E7). href = NBU payload-link URL.
                rel="external" — підказка браузеру не пробувати prefetch і
                не вшивати у history як internal nav (це OS-handle target). */}
            <div className="space-y-3">
                <a
                    href={nbuLinks.primary}
                    rel="external"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 flex w-full items-center justify-center rounded-md px-4 py-3 text-sm font-semibold transition-colors"
                >
                    Інший банк
                </a>
                <a
                    href={nbuLinks.legacy}
                    rel="external"
                    className="border-border text-muted-foreground hover:bg-accent flex w-full items-center justify-center rounded-md border px-4 py-3 text-sm font-medium transition-colors"
                >
                    Інший банк (запасний варіант)
                </a>
                <p className="text-muted-foreground text-center text-xs">
                    Якщо ваш банк не відкрився — спробуйте запасний варіант
                </p>
            </div>

            {/* 2 QR images (E7). next/image не використовуємо — endpoint
                same-origin /api/..., не CDN remotePatterns. */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <figure className="space-y-2 text-center">
                    <img
                        src={qrPrimary}
                        alt="QR на основну адресу"
                        className="border-border mx-auto aspect-square w-full max-w-[240px] rounded-md border bg-white p-2"
                        loading="lazy"
                    />
                    <figcaption className="text-muted-foreground text-xs">
                        Або відскануйте з вашого банк-додатка
                    </figcaption>
                </figure>
                <figure className="space-y-2 text-center">
                    <img
                        src={qrLegacy}
                        alt="QR на запасну адресу"
                        className="border-border mx-auto aspect-square w-full max-w-[240px] rounded-md border bg-white p-2"
                        loading="lazy"
                    />
                    <figcaption className="text-muted-foreground text-xs">
                        Запасний варіант — якщо перший QR не відкрився
                    </figcaption>
                </figure>
            </div>
        </div>
    );
}
