'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { isOnboardingComplete } from '@cyanship/types';
import UiFullPageLoader from '@/shared/ui/UiFullPageLoader';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import { useAuthStore } from '@/entities/user';
import {
    ProfileForm,
    SecuritySection,
    DangerZone,
} from '@/features/profile';
import type { ProfileMode } from '@/features/profile';

function ProfileContent() {
    const searchParams = useSearchParams();
    const user = useAuthStore((s) => s.user);
    const onboardingDone = user ? isOnboardingComplete(user.profile) : true;
    const mode: ProfileMode | null = !onboardingDone
        ? 'new'
        : ((searchParams.get('mode') as ProfileMode) ?? null);
    const t = useTranslations('profile_page');
    const locale = useLocale();
    const router = useRouter();

    if (!user) return null;

    const handleProfileSaved = () => {
        if (mode === 'new') {
            router.push(`/${locale}/dashboard`);
        }
    };

    return (
        <UiPageContainer className="py-16">
            <UiPageHeading>
                {mode === 'new' ? t('new_heading') : t('heading')}
            </UiPageHeading>

            <div className="mt-10 space-y-6">
                <ProfileForm
                    user={user}
                    editable={mode === 'new' || mode === null}
                    onboardingMode={mode === 'new'}
                    onSaved={handleProfileSaved}
                />

                {mode !== 'new' && (
                    <SecuritySection user={user} mode={mode} />
                )}

                {mode === null && <DangerZone />}
            </div>
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
