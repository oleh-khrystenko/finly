'use client';

import { ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { Logo } from '@/entities/brand';
import UiButton from '@/shared/ui/UiButton';
import UiHeaderShell from '@/shared/ui/UiHeaderShell';
import ChangeLang from '@/features/change-lang';
import ChangeTheme from '@/features/change-theme';

export default function AuthLayout({ children }: { children: ReactNode }) {
    const locale = useLocale();

    return (
        <main className="flex flex-1 flex-col">
            <UiHeaderShell>
                <UiButton
                    as="link"
                    href={`/${locale}`}
                    variant="text"
                    size="md"
                    className="p-0"
                >
                    <Logo />
                </UiButton>

                <div className="flex items-center gap-1">
                    <ChangeLang />
                    <ChangeTheme />
                </div>
            </UiHeaderShell>

            <div className="flex flex-1 items-center justify-center px-4 py-8">
                {children}
            </div>
        </main>
    );
}
