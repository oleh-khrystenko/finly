'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { isOnboardingComplete } from '@finly/types';
import UiFullPageLoader from '@/shared/ui/UiFullPageLoader';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiWorkspaceColumns from '@/shared/ui/UiWorkspaceColumns';
import { isValidRedirect } from '@/shared/lib';
import { useAuthStore } from '@/entities/user';
import { ProfileForm, SecuritySection, DangerZone } from '@/features/profile';
import type { ProfileMode } from '@/features/profile';

function ProfileContent() {
    const searchParams = useSearchParams();
    const user = useAuthStore((s) => s.user);
    const onboardingDone = user ? isOnboardingComplete(user.profile) : true;
    const mode: ProfileMode | null = !onboardingDone
        ? 'new'
        : ((searchParams.get('mode') as ProfileMode) ?? null);
    const router = useRouter();

    if (!user) return null;

    const handleProfileSaved = () => {
        if (mode !== 'new') return;

        // Sprint 10 §10.2 — `?next=` consumption з open-redirect-guard. Sprint 3
        // baseline-target — `/business`; Sprint 10 honor-ить next-target з
        // AuthGuard auto-build-у (post-claim або direct deep-link сценарії).
        const rawNext = searchParams.get('next');
        if (rawNext && isValidRedirect(rawNext)) {
            router.push(rawNext);
            return;
        }
        router.push('/business');
    };

    // Онбординг — фокус на одній дії: вузька колонка, лише форма.
    if (mode === 'new') {
        return (
            <UiPageContainer narrow>
                <UiPageHeading>Заповніть профіль</UiPageHeading>

                <div className="mt-6">
                    <ProfileForm
                        user={user}
                        editable
                        onboardingMode
                        onSaved={handleProfileSaved}
                    />
                </div>
            </UiPageContainer>
        );
    }

    // Звичайний профіль — той самий двоколонковий патерн, що деталки:
    // зліва робочий стовп (особисті дані), справа допоміжний (безпека,
    // небезпечна зона).
    return (
        <UiPageContainer className="space-y-6">
            <UiPageHeading>Профіль</UiPageHeading>

            <UiWorkspaceColumns
                main={
                    <ProfileForm
                        user={user}
                        editable={mode === null}
                        onSaved={handleProfileSaved}
                    />
                }
                aside={
                    <>
                        <SecuritySection user={user} mode={mode} />
                        {mode === null && <DangerZone />}
                    </>
                }
            />
        </UiPageContainer>
    );
}

export default function ProfilePage() {
    return (
        <Suspense fallback={<UiFullPageLoader />}>
            <ProfileContent />
        </Suspense>
    );
}
