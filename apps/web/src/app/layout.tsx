import { ReactNode } from 'react';
import localFont from 'next/font/local';
import '@/app/globals.css';
import { AuthInitializer } from '@/features/auth';
import { Providers } from '@/app/providers';
import { Overlays } from '@/app/overlays';

const mulish = localFont({
    src: [
        {
            path: '../shared/fonts/mulish-cyrillic.woff2',
            style: 'normal',
        },
        {
            path: '../shared/fonts/mulish-latin.woff2',
            style: 'normal',
        },
    ],
    display: 'swap',
});

interface RootLayoutProps {
    children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
    return (
        <html lang="uk" className="scroll-smooth" suppressHydrationWarning>
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
                className={`${mulish.className} bg-background text-foreground flex min-h-dvh flex-col`}
            >
                <Providers>
                    <AuthInitializer />
                    <Overlays />
                    {children}
                </Providers>
            </body>
        </html>
    );
}
