import { Metadata } from 'next';

import { QrLandingBlock } from '@/features/qr-landing-preview';
import { fetchMetadata } from '@/shared/seo/metadata';
import { Header } from '@/widgets/header';
import { LandingHero } from '@/widgets/landing-hero';

export function generateMetadata(): Metadata {
    return fetchMetadata({
        page: 'home',
        href: 'landing',
        meta: {
            title: 'Finly — Платіжні QR-коди',
            description:
                'Згенеруйте QR-код за стандартом НБУ і прийміть оплату в один тап з будь-якого банк-додатку.',
        },
    });
}

export default function HomePage() {
    return (
        <>
            <Header />
            <main>
                <LandingHero />
                <QrLandingBlock />
            </main>
        </>
    );
}
