'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter, useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { isOnboardingComplete } from '@neatslip/types';

import UiFullPageLoader from '@/shared/ui/UiFullPageLoader';
import { useAuthStore } from '@/entities/user';

interface AuthGuardProps {
    children: ReactNode;
}

const AuthGuard = ({ children }: AuthGuardProps) => {
    const router = useRouter();
    const pathname = usePathname();
    const { locale } = useParams<{ locale: string }>();
    const t = useTranslations('notifications.users');
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const isLoading = useAuthStore((s) => s.isLoading);
    const user = useAuthStore((s) => s.user);

    const onboardingDone = user ? isOnboardingComplete(user.profile) : true;
    const isProfilePage = pathname.includes('/profile');
    const onboardingMessage = t('onboarding_required');

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.replace(`/${locale}/auth/signin`);
        }
    }, [isLoading, isAuthenticated, router, locale]);

    useEffect(() => {
        if (isAuthenticated && !onboardingDone && !isProfilePage) {
            toast.info(onboardingMessage);
            router.replace(`/${locale}/profile?mode=new`);
        }
    }, [isAuthenticated, onboardingDone, isProfilePage, router, locale, onboardingMessage]);

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
