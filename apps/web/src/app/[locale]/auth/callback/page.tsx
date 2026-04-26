'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import UiButton from '@/shared/ui/UiButton';
import UiFullPageLoader from '@/shared/ui/UiFullPageLoader';
import UiSpinner from '@/shared/ui/UiSpinner';
import { refreshToken, getMe, restoreAccount, acceptTerms } from '@/shared/api';
import { consumeRedirect } from '@/shared/lib';
import { useAuthStore } from '@/entities/user';

export default function CallbackPage() {
    const t = useTranslations('auth_page.callback');
    const tRecovery = useTranslations('auth_page.recovery');
    const router = useRouter();
    const { locale } = useParams<{ locale: string }>();

    const [accountDeleted, setAccountDeleted] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        const isAccountDeleted =
            new URLSearchParams(window.location.search).get(
                'account_deleted'
            ) === 'true';

        const authenticate = async () => {
            try {
                await refreshToken();
                const user = await getMe();

                // getMe succeeds → user is active, ignore URL param
                document.cookie = 'bid_account_deleted=; path=/; max-age=0';
                useAuthStore.getState().setUser(user);

                // Record terms consent for Google OAuth flow
                // (sign-in page checkbox was checked before redirect)
                await acceptTerms().catch(() => {});

                router.replace(consumeRedirect(`/${locale}/dashboard`));
            } catch {
                // getMe failed → user is soft-deleted (JwtActiveGuard blocks)
                if (isAccountDeleted) {
                    useAuthStore.getState().clearUser();
                    document.cookie = 'bid_account_deleted=true; path=/';
                    setAccountDeleted(true);
                    return;
                }

                router.replace(`/${locale}/auth/signin`);
            }
        };

        void authenticate();
    }, [router, locale]);

    const handleRestore = async () => {
        setSubmitting(true);
        try {
            await restoreAccount();
            document.cookie = 'bid_account_deleted=; path=/; max-age=0';
            toast.success(tRecovery('restored'));
            const user = await getMe();
            useAuthStore.getState().setUser(user);
            router.replace(consumeRedirect(`/${locale}/dashboard`));
        } catch {
            setSubmitting(false);
            router.replace(`/${locale}/auth/signin`);
        }
    };

    if (accountDeleted) {
        return (
            <div className="w-full max-w-md space-y-6 text-center">
                <h1 className="text-foreground text-3xl font-bold">
                    {tRecovery('title')}
                </h1>
                <p className="text-muted-foreground">
                    {t('account_deleted_description')}
                </p>

                <UiButton
                    variant="filled"
                    size="lg"
                    className="w-full justify-center"
                    disabled={submitting}
                    onClick={() => void handleRestore()}
                >
                    {submitting ? (
                        <UiSpinner size="sm" />
                    ) : (
                        tRecovery('restore_button')
                    )}
                </UiButton>
            </div>
        );
    }

    return <UiFullPageLoader message={t('loading')} />;
}
