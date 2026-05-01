import { Metadata } from 'next';
import { Header } from '@/widgets/header';
import { fetchMetadata } from '@/shared/seo/metadata';

export function generateMetadata(): Metadata {
    return fetchMetadata({
        page: 'privacy',
        href: 'privacy',
        meta: {
            title: 'Політика конфіденційності — Finly',
            description: 'Політика конфіденційності Finly.',
        },
    });
}

export default function PrivacyPage() {
    return (
        <>
            <Header />
            <main className="mx-auto max-w-3xl px-6 py-12">
                <h1 className="text-3xl font-semibold tracking-tight">
                    Політика конфіденційності
                </h1>
                <p className="mt-4 text-base text-muted-foreground">
                    Заглушка політики конфіденційності.
                </p>
            </main>
        </>
    );
}
