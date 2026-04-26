'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AxiosError } from 'axios';
import { CheckCircle } from 'lucide-react';
import UiButton from '@/shared/ui/UiButton';
import UiFullPageLoader from '@/shared/ui/UiFullPageLoader';
import { verifyMagicLink, getMe, acceptTerms, getApiMessageKey } from '@/shared/api';
import { isValidRedirect } from '@/shared/lib';
import { useAuthStore } from '@/entities/user';

type VerifyStatus = 'verifying' | 'success' | 'deleted' | 'error';

function VerifyContent() {
    const t = useTranslations('auth_page.verify');
    const tErrors = useTranslations();
    const router = useRouter();
    const { locale } = useParams<{ locale: string }>();
    const searchParams = useSearchParams();
    const token = searchParams.get('token');
    const rawRedirect = searchParams.get('redirect');
    const redirectTarget =
        rawRedirect && isValidRedirect(rawRedirect)
            ? rawRedirect
            : `/${locale}/profile`;
    const [status, setStatus] = useState<VerifyStatus>(
        token ? 'verifying' : 'error'
    );
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        if (!token) return;

        const verify = async () => {
            try {
                const result = await verifyMagicLink(token);

                switch (result.purpose) {
                    case 'register': {
                        await acceptTerms();
                        const user = await getMe();
                        useAuthStore.getState().setUser(user);
                        setStatus('success');
                        router.replace(redirectTarget);
                        break;
                    }

                    case 'login': {
                        await acceptTerms();
                        const user = await getMe();
                        useAuthStore.getState().setUser(user);
                        setStatus('success');
                        router.replace(redirectTarget);
                        break;
                    }

                    case 'delete-account': {
                        setStatus('deleted');
                        break;
                    }

                    default: {
                        await acceptTerms();
                        const user = await getMe();
                        useAuthStore.getState().setUser(user);
                        setStatus('success');
                        router.replace(redirectTarget);
                    }
                }
            } catch (err) {
                setStatus('error');
                const code =
                    err instanceof AxiosError
                        ? err.response?.data?.error?.code
                        : undefined;
                if (code) {
                    setErrorMessage(
                        tErrors(getApiMessageKey(code, 'auth'))
                    );
                }
            }
        };

        void verify();
    }, [token, router, locale, tErrors]);

    if (status === 'deleted') {
        return (
            <div className="flex flex-col items-center gap-4">
                <CheckCircle className="h-12 w-12 text-success" />
                <p className="text-foreground text-lg font-semibold">
                    {t('deleted_heading')}
                </p>
                <p className="text-muted-foreground max-w-sm text-center text-sm">
                    {t('deleted_description')}
                </p>
                <UiButton
                    as="link"
                    href={`/${locale}/auth/signin`}
                    variant="filled"
                    size="md"
                >
                    {t('deleted_signin_button')}
                </UiButton>
            </div>
        );
    }

    if (status === 'error') {
        return (
            <div className="flex flex-col items-center gap-4">
                <p className="text-foreground text-lg">
                    {t('error_heading')}
                </p>
                <p className="text-muted-foreground text-sm">
                    {errorMessage || t('error_description')}
                </p>
                <UiButton
                    as="link"
                    href={`/${locale}/auth/signin`}
                    variant="filled"
                    size="md"
                >
                    {t('retry_button')}
                </UiButton>
            </div>
        );
    }

    return (
        <UiFullPageLoader
            message={status === 'success' ? t('redirecting') : t('verifying')}
        />
    );
}

export default function VerifyPage() {
    return (
        <Suspense fallback={<UiFullPageLoader />}>
            <VerifyContent />
        </Suspense>
    );
}
