import { Metadata } from 'next';
import { MetaProps } from '@/shared/types/settings';
import { ENV } from '@/shared/config';

const BASE_URL = ENV.NEXT_PUBLIC_BASE_URL;

const FALLBACK_TITLE = 'Finly';
const FALLBACK_DESCRIPTION =
    'Finly — сервіс для українських ФОП та їх бухгалтерів.';

export function fetchMetadata({
    page,
    href,
    meta,
    noindex,
}: MetaProps): Metadata {
    let title = FALLBACK_TITLE;
    let description = FALLBACK_DESCRIPTION;

    if (page === null && meta) {
        title = meta.title;
        description = meta.description;
    } else if (meta) {
        title = meta.title;
        description = meta.description;
    }

    const path = href === 'landing' ? '' : `/${href}`;
    const canonicalUrl = `${BASE_URL}${path}`;

    return {
        title,
        description,
        alternates: {
            canonical: canonicalUrl,
        },
        ...(noindex && {
            robots: { index: false, follow: false },
        }),
        openGraph: {
            title,
            description,
            url: canonicalUrl,
            siteName: 'Finly',
            locale: 'uk_UA',
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
