import { Metadata } from 'next';

import { QrLandingBlock } from '@/features/qr-landing-preview';
import { fetchMetadata } from '@/shared/seo/metadata';
import { LandingBanks } from '@/widgets/landing-banks';
import { LandingClosingCta } from '@/widgets/landing-closing-cta';
import { LandingContrast } from '@/widgets/landing-contrast';
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
            title: 'Finly — платіжні QR-коди за стандартом НБУ для українського бізнесу',
            description:
                'Одна сторінка зі своїми реквізитами. Клієнт сканує QR, і банк-додаток відкривається із заповненою формою. Без комісій, без диктування IBAN у вайбер.',
        },
    });
}

export default function HomePage() {
    return (
        <>
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
                <LandingClosingCta />
            </main>
            <LandingFooter />
        </>
    );
}
