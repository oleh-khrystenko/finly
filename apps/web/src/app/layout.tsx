import { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import '@/app/globals.css';
import { ENV } from '@/shared/config';
import { THEME_BACKGROUND } from '@/shared/styles/themeColors';
import { AuthInitializer } from '@/features/auth';
import { Providers } from '@/app/providers';
import { Overlays } from '@/app/overlays';

// `metadataBase` дає резолвити відносні URL у метаданих (canonical, OG). Дефолт
// title гарантує непорожній заголовок вкладки на сторінках, що не мають власного
// (кабінет, auth). Іконки: theme-scoped SVG (основні) + растровий фолбек фавікона
// + apple-touch для home-screen.
export const metadata: Metadata = {
    metadataBase: new URL(ENV.NEXT_PUBLIC_BASE_URL),
    title: {
        default: 'Finly — веди справи, а не папери',
        template: '%s',
    },
    icons: {
        icon: [
            {
                url: '/logo/light-theme.svg',
                type: 'image/svg+xml',
                media: '(prefers-color-scheme: light)',
            },
            {
                url: '/logo/dark-theme.svg',
                type: 'image/svg+xml',
                media: '(prefers-color-scheme: dark)',
            },
            { url: '/icons/favicon-48.png', type: 'image/png', sizes: '48x48' },
        ],
        apple: '/icons/apple-touch-icon.png',
    },
};

export const viewport: Viewport = {
    colorScheme: 'light dark',
    themeColor: [
        {
            media: '(prefers-color-scheme: light)',
            color: THEME_BACKGROUND.light,
        },
        { media: '(prefers-color-scheme: dark)', color: THEME_BACKGROUND.dark },
    ],
};

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
    // Mulish — variable-шрифт (axis ваги 200→1000, дефолт ExtraLight 200).
    // Без явного діапазону `@font-face` затискає вагу на дефолт і `font-bold`
    // дає синтетичний faux-bold замість справжнього майстра Bold(700). Діапазон
    // відкриває весь axis, тож `font-bold` тягне реальні 700 — той самий майстер,
    // що запікається у QR-lockup (`Mulish_700Bold.ttf`).
    weight: '200 1000',
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
