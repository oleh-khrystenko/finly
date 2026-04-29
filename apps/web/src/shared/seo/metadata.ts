import { Metadata } from 'next';
import { MetaProps } from '@/shared/types/settings';
import { LANG, type Lang } from '@neatslip/types';
import { ENV } from '@/shared/config';

const BASE_URL = ENV.NEXT_PUBLIC_BASE_URL;

const FALLBACK_DESCRIPTION: Record<Lang, string> = {
    [LANG.UK]: 'NeatSlip — сервіс для українських ФОП та їх бухгалтерів.',
    [LANG.EN]: 'NeatSlip — service for Ukrainian sole proprietors and their accountants.',
};

function resolveLang(locale: string): Lang {
    return locale === LANG.EN ? LANG.EN : LANG.UK;
}

export async function fetchMetadata({
    params,
    page,
    href,
    meta,
}: MetaProps): Promise<Metadata> {
    let locale: string;

    try {
        const resolved = await params;
        locale = resolved?.locale;
        if (!locale) throw new Error('Locale is missing in params');
    } catch (error) {
        console.error('❌ Failed to resolve locale from params:', error);
        locale = LANG.UK;
    }

    let title = 'NeatSlip';
    let description = FALLBACK_DESCRIPTION[resolveLang(locale)];

    if (page === null) {
        if (meta) {
            title = meta.title;
            description = meta.description;
        }
    } else {
        const raw = String(locale ?? '').toLowerCase();
        const normalized = /^[a-z]{2}(-[a-z]{2})?$/i.test(raw) ? raw : LANG.UK;

        interface PageMessages {
            head?: { title?: string; description?: string };
        }

        type Messages = Record<string, PageMessages>;

        async function importMessages(loc: string): Promise<Messages> {
            try {
                const mod = await import(`../../../messages/${loc}.json`);
                return mod.default ?? mod;
            } catch {
                if (loc !== LANG.UK) {
                    const modUk = await import(
                        `../../../messages/${LANG.UK}.json`
                    );
                    return modUk.default ?? modUk;
                }
                return {};
            }
        }

        const messages = await importMessages(normalized);
        const pageData = messages[`${page}_page`];

        title = pageData?.head?.title ?? title;
        description = pageData?.head?.description ?? description;
    }

    const path = href === 'landing' ? '' : `/${href}`;

    const canonicalUrl = `${BASE_URL}/${locale}${path}`;

    return {
        title,
        description,
        alternates: {
            canonical: canonicalUrl,
            languages: {
                'x-default': `${BASE_URL}/uk${path}`,
                'uk-ua': `${BASE_URL}/uk${path}`,
                'en-ua': `${BASE_URL}/en${path}`,
            },
        },
        openGraph: {
            title,
            description,
            url: canonicalUrl,
            siteName: 'NeatSlip',
            locale: locale === 'uk' ? 'uk_UA' : 'en_US',
            type: 'website',
            images: [
                {
                    url: `${BASE_URL}/images/og-banner-v2.png`,
                    width: 1200,
                    height: 630,
                    alt: title,
                },
            ],
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
            images: [`${BASE_URL}/images/og-banner-v2.png`],
        },
    };
}
