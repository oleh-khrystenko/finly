import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/widgets/header';
import { fetchMetadata } from '@/shared/seo/metadata';
import { MetaProps } from '@/shared/types/settings';

export async function generateMetadata(props: MetaProps): Promise<Metadata> {
    return await fetchMetadata({ ...props, page: 'privacy', href: 'privacy' });
}

interface PrivacyPageProps {
    params: Promise<{ locale: string }>;
}

export default async function PrivacyPage({ params }: PrivacyPageProps) {
    const { locale } = await params;
    const t = await getTranslations({ locale, namespace: 'privacy_page' });

    return (
        <>
            <Header />
            <main className="mx-auto max-w-3xl px-6 py-12">
                <h1 className="text-3xl font-semibold tracking-tight">
                    {t('heading')}
                </h1>
                <p className="mt-4 text-base text-muted-foreground">
                    {t('placeholder')}
                </p>
            </main>
        </>
    );
}
