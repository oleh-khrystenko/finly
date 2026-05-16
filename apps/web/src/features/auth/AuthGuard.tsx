'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { isOnboardingComplete } from '@finly/types';

import UiFullPageLoader from '@/shared/ui/UiFullPageLoader';
import { useAuthStore } from '@/entities/user';

interface AuthGuardProps {
    children: ReactNode;
}

const ONBOARDING_REQUIRED = 'Будь ласка, заповніть профіль для продовження';

/**
 * Sprint 10 §10.2 — на onboarding-incomplete-редіректі AuthGuard конструює
 * `next` з поточного URL і прокидає у `/profile?mode=new&next=...`. Після
 * успішного PATCH `/users/me` profile-page редіректить назад на оригінальний
 * target. Покриває обидва сценарії одним механізмом:
 *
 *   1. Post-claim flow: verify-page робить router.replace на claim-target,
 *      AuthGuard на target-page бачить incomplete-profile → /profile з `next`.
 *   2. Direct deep-link у incomplete-profile-state: user набирає
 *      /business/foo напряму → AuthGuard будує next=/business/foo.
 *
 * Open-redirect-ризик відсутній: `pathname` з `usePathname()` — exclusively
 * in-app relative path. `searchParams` доповнюється без origin.
 */
const AuthGuard = ({ children }: AuthGuardProps) => {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
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
            const queryString = searchParams.toString();
            const nextPath = queryString
                ? `${pathname}?${queryString}`
                : pathname;
            const target = `/profile?mode=new&next=${encodeURIComponent(nextPath)}`;
            toast.info(ONBOARDING_REQUIRED);
            router.replace(target);
        }
    }, [
        isAuthenticated,
        onboardingDone,
        isProfilePage,
        pathname,
        searchParams,
        router,
    ]);

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
