'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { isOnboardingComplete } from '@finly/types';

import UiFullPageLoader from '@/shared/ui/UiFullPageLoader';
import { useAuthStore } from '@/entities/user';

interface AuthGuardProps {
    children: ReactNode;
}

const ONBOARDING_REQUIRED = 'Будь ласка, заповніть профіль для продовження';

const AuthGuard = ({ children }: AuthGuardProps) => {
    const router = useRouter();
    const pathname = usePathname();
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const isLoading = useAuthStore((s) => s.isLoading);
    const user = useAuthStore((s) => s.user);

    const onboardingDone = user ? isOnboardingComplete(user.profile) : true;
    const isProfilePage = pathname.includes('/profile');

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.replace('/auth/signin');
        }
    }, [isLoading, isAuthenticated, router]);

    useEffect(() => {
        if (isAuthenticated && !onboardingDone && !isProfilePage) {
            toast.info(ONBOARDING_REQUIRED);
            router.replace('/profile?mode=new');
        }
    }, [isAuthenticated, onboardingDone, isProfilePage, router]);

    if (isLoading) {
        return <UiFullPageLoader />;
    }

    if (!isAuthenticated) {
        return null;
    }

    if (!onboardingDone && !isProfilePage) {
        return null;
    }

    return <>{children}</>;
};

export default AuthGuard;
