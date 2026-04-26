import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import localFont from 'next/font/local';
import '@/app/globals.css';
import { PageParams } from '@/shared/types/settings';
import { AuthInitializer } from '@/features/auth';
import { Providers } from '@/app/providers';
import { Overlays } from '@/app/overlays';

const mulish = localFont({
    src: [
        {
            path: '../../shared/fonts/mulish-cyrillic.woff2',
            style: 'normal',
        },
        {
            path: '../../shared/fonts/mulish-latin.woff2',
            style: 'normal',
        },
    ],
    display: 'swap',
});

interface LocaleLayoutProps extends PageParams {
    children: ReactNode;
}

export default async function LocaleLayout({
    children,
    params,
}: LocaleLayoutProps) {
    const { locale } = await params;
    if (!hasLocale(routing.locales, locale)) {
        notFound();
    }

    return (
        <html lang={locale} className="scroll-smooth" suppressHydrationWarning>
            <head>
                <meta name="darkreader-lock" />
                <meta name="color-scheme" content="light dark" />
                <link
                    rel="icon"
                    href="/logo/light-theme.svg"
                    type="image/svg+xml"
                    media="(prefers-color-scheme: light)"
                />
                <link
                    rel="icon"
                    href="/logo/dark-theme.svg"
                    type="image/svg+xml"
                    media="(prefers-color-scheme: dark)"
                />
            </head>

            <body
                className={`${mulish.className} flex min-h-dvh flex-col bg-background text-foreground`}
            >
                <Providers>
                    <NextIntlClientProvider>
                        <AuthInitializer />
                        <Overlays />
                        {children}
                    </NextIntlClientProvider>
                </Providers>
            </body>
        </html>
    );
}
