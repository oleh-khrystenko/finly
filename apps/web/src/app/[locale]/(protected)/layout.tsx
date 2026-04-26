import { ReactNode } from 'react';
import { Header } from '@/widgets/header';
import { AuthGuard } from '@/features/auth';

interface ProtectedLayoutProps {
    children: ReactNode;
}

export default function ProtectedLayout({ children }: ProtectedLayoutProps) {
    return (
        <>
            <Header />
            <AuthGuard>{children}</AuthGuard>
        </>
    );
}
