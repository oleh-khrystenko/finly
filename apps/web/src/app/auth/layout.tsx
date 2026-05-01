import { ReactNode } from 'react';
import { Logo } from '@/entities/brand';
import UiButton from '@/shared/ui/UiButton';
import UiHeaderShell from '@/shared/ui/UiHeaderShell';
import ChangeTheme from '@/features/change-theme';

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
        </main>
    );
}
