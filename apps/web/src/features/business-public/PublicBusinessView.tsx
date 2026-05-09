'use client';

import { BANK_LABEL, type BankCode, type BusinessType } from '@finly/types';
import { BANK_DISPLAY } from '@/shared/icons';
import UiQrImage from '@/shared/ui/UiQrImage';

interface Props {
    /**
     * Sprint 7 §SP-5 — `type` лишається у Props для майбутніх SEO-meta /
     * aria-label use-case-ів (cabinet preview-toggle передає його з cabinet
     * fetch-у). H1-heading його **не** використовує — Sprint 7 уніфікував
     * heading до type-нейтрального формулювання.
     */
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
 * Sprint 3 §3.9 + Sprint 7 §SP-5 — публічна вивіска бізнесу. Reusable у двох
 * місцях:
 *   1. Cabinet preview-toggle (Sprint 3 B2 "Перегляд як клієнт").
 *   2. Host-aware route (`app/host-pay/[slug]/page.tsx` через middleware-
 *      rewrite з `pay.finly.com.ua/{slug}`).
 *
 * **Sprint 7 §SP-5 — heading type-нейтральний**: `'Платіж на користь {name}'`
 * для всіх 4 типів. До Sprint 7 був `'Оплата на ${BUSINESS_TYPE_LABEL[type]}
 * ${name}'`, але після розширення enum-у до 4 типів цей формат давав
 * лінгвістично незграбні комбінації ("Оплата на фізособа Іваненко"); крім
 * того, назва бізнесу зазвичай вже містить юр-форму ("ФОП Іваненко І.І.",
 * "ТОВ Каса Здоров'я") — type-префікс дублював інформацію. "Платіж на користь
 * {name}" — нейтральне юр-формулювання, що працює для всіх кейсів.
 *
 * **Type залишається у Props** — SEO meta-tag і aria-label-ам потрібен для
 * `<title>` пошукової видачі ("Оплата на ФОП Іваненко — Finly"); але h1 його
 * не використовує (sprint plan §SP-5 явно фіксує цей trade-off).
 *
 * Layout (E7 рішення):
 *   - Заголовок "Платіж на користь {name}".
 *   - Сітка 11 generic bank-tile (B1: неактивні, grayscale, з підписом
 *     "Незабаром"). Sprint 5 розблокує per-bank deep-links.
 *   - 2 активні CTA з `nbuLinks.primary`/`.legacy` href — ОС handle через
 *     app-link, відкриває банк з реквізитами (рішення A2).
 *   - 2 QR-картинки на API endpoints (host=primary | legacy).
 */
export default function PublicBusinessView({
    type: _type,
    name,
    slug,
    acceptedBanks,
    nbuLinks,
    apiBase = '/api',
}: Props) {
    const heading = `Платіж на користь ${name}`;

    const qrPrimary = `${apiBase}/businesses/public/${encodeURIComponent(slug)}/qr/nbu.png?host=primary`;
    const qrLegacy = `${apiBase}/businesses/public/${encodeURIComponent(slug)}/qr/nbu.png?host=legacy`;

    return (
        <div className="mx-auto max-w-xl space-y-8 px-4 py-8">
            <h1 className="text-foreground text-center text-2xl font-bold tracking-tight md:text-3xl">
                {heading}
            </h1>

            <div className="space-y-3">
                <h2 className="text-foreground text-center text-base font-semibold">
                    Оберіть банк, з якого бажаєте оплатити
                </h2>
                {/* 11 inactive bank tiles (B1). Іконка з `BANK_DISPLAY` map
                    (`apps/web/src/shared/icons/banks/`). Grayscale + opacity-70
                    + cursor-not-allowed маркують inactive стан; Sprint 5 розблокує
                    per-bank deep-links без зміни цього layout. */}
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                    {acceptedBanks.map((bank) => {
                        const Icon = BANK_DISPLAY[bank];
                        return (
                            <div
                                key={bank}
                                aria-disabled
                                className="border-border bg-muted/30 text-muted-foreground flex h-20 cursor-not-allowed flex-col items-center justify-center gap-1.5 rounded-md border px-2 text-center opacity-70 grayscale"
                                title="Незабаром"
                            >
                                <div className="size-10">
                                    <Icon />
                                </div>
                                <span className="text-[10px] leading-tight">
                                    {BANK_LABEL[bank]}
                                </span>
                            </div>
                        );
                    })}
                </div>
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

            {/* 2 QR images (E7). next/image не використовуємо — re-encode
                ламає precision raster QR + cross-origin remotePatterns
                overhead без виграшу (HTTP-кеш на API уже є). */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <figure className="space-y-2 text-center">
                    <UiQrImage
                        src={qrPrimary}
                        alt="QR на основну адресу"
                        className="border-border mx-auto w-full max-w-[240px] rounded-md border bg-white p-2"
                    />
                    <figcaption className="text-muted-foreground text-xs">
                        Або відскануйте з вашого банк-додатка
                    </figcaption>
                </figure>
                <figure className="space-y-2 text-center">
                    <UiQrImage
                        src={qrLegacy}
                        alt="QR на запасну адресу"
                        className="border-border mx-auto w-full max-w-[240px] rounded-md border bg-white p-2"
                    />
                    <figcaption className="text-muted-foreground text-xs">
                        Запасний варіант — якщо перший QR не відкрився
                    </figcaption>
                </figure>
            </div>
        </div>
    );
}
