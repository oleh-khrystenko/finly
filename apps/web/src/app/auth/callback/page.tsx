'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import UiButton from '@/shared/ui/UiButton';
import UiFullPageLoader from '@/shared/ui/UiFullPageLoader';
import UiSpinner from '@/shared/ui/UiSpinner';
import { refreshToken, getMe, restoreAccount, acceptTerms } from '@/shared/api';
import { consumeRedirect } from '@/shared/lib';
import { useAuthStore } from '@/entities/user';

export default function CallbackPage() {
    const router = useRouter();

    const [accountDeleted, setAccountDeleted] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        const isAccountDeleted =
            new URLSearchParams(window.location.search).get(
                'account_deleted',
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

                router.replace(consumeRedirect('/dashboard'));
            } catch {
                // getMe failed → user is soft-deleted (JwtActiveGuard blocks)
                if (isAccountDeleted) {
                    useAuthStore.getState().clearUser();
                    document.cookie = 'bid_account_deleted=true; path=/';
                    setAccountDeleted(true);
                    return;
                }

                router.replace('/auth/signin');
            }
        };

        void authenticate();
    }, [router]);

    const handleRestore = async () => {
        setSubmitting(true);
        try {
            await restoreAccount();
            document.cookie = 'bid_account_deleted=; path=/; max-age=0';
            toast.success('Акаунт відновлено!');
            const user = await getMe();
            useAuthStore.getState().setUser(user);
            router.replace(consumeRedirect('/dashboard'));
        } catch {
            setSubmitting(false);
            router.replace('/auth/signin');
        }
    };

    if (accountDeleted) {
        return (
            <div className="w-full max-w-md space-y-6 text-center">
                <h1 className="text-foreground text-3xl font-bold">
                    Акаунт деактивовано
                </h1>
                <p className="text-muted-foreground">
                    Ваш акаунт заплановано до видалення. Відновіть його,
                    натиснувши кнопку нижче.
                </p>

                <UiButton
                    variant="filled"
                    size="lg"
                    className="w-full justify-center"
                    disabled={submitting}
                    onClick={() => void handleRestore()}
                >
                    {submitting ? <UiSpinner size="sm" /> : 'Відновити акаунт'}
                </UiButton>
            </div>
        );
    }

    return <UiFullPageLoader message="Авторизація…" />;
}
