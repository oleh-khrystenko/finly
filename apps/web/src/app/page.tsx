import { Metadata } from 'next';
import { Header } from '@/widgets/header';
import UiButton from '@/shared/ui/UiButton';
import { fetchMetadata } from '@/shared/seo/metadata';

export function generateMetadata(): Metadata {
    return fetchMetadata({
        page: 'home',
        href: 'landing',
        meta: {
            title: 'NeatSlip',
            description: 'Увійдіть, щоб користуватися застосунком.',
        },
    });
}

export default function HomePage() {
    return (
        <>
            <Header />
            <main className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-6 text-center">
                <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                    NeatSlip
                </h1>
                <p className="mt-4 max-w-prose text-base text-muted-foreground">
                    Заглушка лендінгу. Увійдіть, щоб користуватися застосунком.
                </p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <UiButton as="link" href="/auth/signin" variant="filled">
                        Почати
                    </UiButton>
                    <UiButton as="link" href="/auth/signin" variant="outline">
                        Увійти
                    </UiButton>
                </div>
            </main>
        </>
    );
}
