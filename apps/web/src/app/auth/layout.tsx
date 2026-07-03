import { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Logo } from '@/entities/brand';
import { AppFooter } from '@/widgets/app-footer';
import UiButton from '@/shared/ui/UiButton';
import UiHeaderShell from '@/shared/ui/UiHeaderShell';
import ChangeTheme from '@/features/change-theme';

// Auth-сторінки — клієнтські компоненти (не можуть експортувати metadata самі),
// тож title + noindex ставимо на layout: непорожній заголовок вкладки для всіх
// auth-роутів і явна неіндексація (не лише через robots disallow).
export const metadata: Metadata = {
    title: 'Вхід у Finly',
    robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
    return (
        <main className="flex flex-1 flex-col">
            <UiHeaderShell>
                <UiButton
                    as="link"
                    href="/"
                    variant="text"
                    size="md"
                    className="p-0"
                >
                    <Logo />
                </UiButton>

                <div className="flex items-center gap-1">
                    <ChangeTheme />
                </div>
            </UiHeaderShell>

            <div className="flex flex-1 items-center justify-center px-4 py-8">
                {children}
            </div>

            <AppFooter />
        </main>
    );
}
