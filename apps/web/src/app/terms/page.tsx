import { Metadata } from 'next';
import { Header } from '@/widgets/header';
import { fetchMetadata } from '@/shared/seo/metadata';

export function generateMetadata(): Metadata {
    return fetchMetadata({
        page: 'terms',
        href: 'terms',
        meta: {
            title: 'Умови використання — NeatSlip',
            description: 'Умови використання NeatSlip.',
        },
    });
}

export default function TermsPage() {
    return (
        <>
            <Header />
            <main className="mx-auto max-w-3xl px-6 py-12">
                <h1 className="text-3xl font-semibold tracking-tight">
                    Умови використання
                </h1>
                <p className="mt-4 text-base text-muted-foreground">
                    Заглушка умов використання.
                </p>
            </main>
        </>
    );
}
