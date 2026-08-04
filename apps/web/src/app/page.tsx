import { Metadata } from 'next';
import { type BillingCatalog } from '@finly/types';

import { QrLandingBlock } from '@/features/qr-landing-preview';
import { loadCatalog } from '@/features/billing';
import { ENV } from '@/shared/config';
import { JsonLd } from '@/shared/seo/JsonLd';
import { fetchMetadata } from '@/shared/seo/metadata';
import { LandingBanks } from '@/widgets/landing-banks';
import { LandingClosingCta } from '@/widgets/landing-closing-cta';
import { LandingContrast } from '@/widgets/landing-contrast';
import { LandingFaq } from '@/widgets/landing-faq';
import { LandingFooter } from '@/widgets/landing-footer';
import { LandingHero } from '@/widgets/landing-hero';
import { LandingHowItWorks } from '@/widgets/landing-how-it-works';
import { LandingNavSetup } from '@/widgets/landing-nav-setup';
import { LandingPartner } from '@/widgets/landing-partner';
import { LandingWhy } from '@/widgets/landing-why';
import { Header } from '@/widgets/header';

export function generateMetadata(): Metadata {
    return fetchMetadata({
        page: 'home',
        href: 'landing',
        meta: {
            title: 'Платіжний QR-код і рахунок за реквізитами ФОП | Finly',
            description:
                'Платіжна сторінка з вашими реквізитами та QR за стандартом НБУ. Клієнт сканує, банк-додаток відкриває готову форму оплати. Без комісій і помилок у реквізитах.',
            ogTitle:
                'Платіжний QR-код і рахунок за реквізитами для українського ФОП',
            ogDescription:
                'Клієнт сканує QR, і банк-додаток відкриває готову форму оплати. Без комісій і без диктування IBAN у месенджері.',
        },
    });
}

/**
 * Offer-вузли SoftwareApplication з реальних цін каталогу (копійки → гривні,
 * major-units string за schema.org). Безкоштовний рівень включається першим.
 */
function buildOffers(catalog: BillingCatalog): Array<Record<string, string>> {
    const toOffer = (name: string, priceAmount: number) => ({
        '@type': 'Offer',
        name,
        price: (priceAmount / 100).toFixed(2),
        priceCurrency: catalog.currency,
    });
    return [
        toOffer('Безкоштовно', 0),
        toOffer('Бренд', catalog.brand.pricePerBusiness),
        ...catalog.documents.tiers.map((tier) =>
            toOffer(`Документи · ${tier.size}`, tier.priceAmount)
        ),
    ];
}

export default async function HomePage() {
    const baseUrl = ENV.NEXT_PUBLIC_BASE_URL.replace(/\/$/, '');
    const organizationId = `${baseUrl}/#organization`;
    const websiteId = `${baseUrl}/#website`;
    const softwareId = `${baseUrl}/#software`;

    const catalog = await loadCatalog();
    const offers = catalog ? buildOffers(catalog) : [];

    return (
        <>
            <JsonLd
                data={{
                    '@context': 'https://schema.org',
                    '@graph': [
                        {
                            '@type': 'Organization',
                            '@id': organizationId,
                            name: 'Finly',
                            url: baseUrl,
                            logo: `${baseUrl}/logo/mark-512.png`,
                            contactPoint: {
                                '@type': 'ContactPoint',
                                email: 'support@finly.com.ua',
                                contactType: 'customer support',
                                availableLanguage: 'uk',
                            },
                        },
                        {
                            '@type': 'WebSite',
                            '@id': websiteId,
                            url: baseUrl,
                            name: 'Finly',
                            inLanguage: 'uk-UA',
                            publisher: { '@id': organizationId },
                        },
                        {
                            '@type': 'SoftwareApplication',
                            '@id': softwareId,
                            name: 'Finly',
                            url: baseUrl,
                            applicationCategory: 'BusinessApplication',
                            operatingSystem: 'Web',
                            inLanguage: 'uk-UA',
                            provider: { '@id': organizationId },
                            description:
                                'SaaS-сервіс для українських ФОП і бухгалтерів: платіжні сторінки, рахунки та QR-коди за стандартом НБУ.',
                            ...(offers.length > 0 && { offers }),
                        },
                    ],
                }}
            />
            <Header />
            <LandingNavSetup />
            <main>
                <LandingHero />
                <LandingContrast />
                <LandingHowItWorks />
                <QrLandingBlock />
                <LandingWhy />
                <LandingBanks />
                <LandingPartner />
                <LandingFaq />
                <LandingClosingCta />
            </main>
            <LandingFooter />
        </>
    );
}
