import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/widgets/header';
import UiButton from '@/shared/ui/UiButton';
import { fetchMetadata } from '@/shared/seo/metadata';
import { MetaProps } from '@/shared/types/settings';

export async function generateMetadata(props: MetaProps): Promise<Metadata> {
    return await fetchMetadata({ ...props, page: 'home', href: 'landing' });
}

interface HomePageProps {
    params: Promise<{ locale: string }>;
}

export default async function HomePage({ params }: HomePageProps) {
    const { locale } = await params;
    const t = await getTranslations({ locale, namespace: 'home_page' });

    return (
        <>
            <Header />
            <main className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-6 text-center">
                <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                    {t('heading')}
                </h1>
                <p className="mt-4 max-w-prose text-base text-muted-foreground">
                    {t('description')}
                </p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <UiButton
                        as="link"
                        href={`/${locale}/auth/signin`}
                        variant="filled"
                    >
                        {t('cta_get_started')}
                    </UiButton>
                    <UiButton
                        as="link"
                        href={`/${locale}/auth/signin`}
                        variant="outline"
                    >
                        {t('cta_signin')}
                    </UiButton>
                </div>
            </main>
        </>
    );
}
