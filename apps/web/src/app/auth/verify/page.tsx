'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AxiosError } from 'axios';
import { CheckCircle } from 'lucide-react';
import UiButton from '@/shared/ui/UiButton';
import UiFullPageLoader from '@/shared/ui/UiFullPageLoader';
import {
    verifyMagicLink,
    getMe,
    acceptTerms,
    getApiMessage,
} from '@/shared/api';
import { isValidRedirect } from '@/shared/lib';
import { useAuthStore } from '@/entities/user';

type VerifyStatus = 'verifying' | 'success' | 'deleted' | 'error';

function VerifyContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get('token');
    const rawRedirect = searchParams.get('redirect');
    const redirectTarget =
        rawRedirect && isValidRedirect(rawRedirect) ? rawRedirect : '/profile';
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
                    setErrorMessage(getApiMessage(code, 'auth'));
                }
            }
        };

        void verify();
    }, [token, router, redirectTarget]);

    if (status === 'deleted') {
        return (
            <div className="flex flex-col items-center gap-4">
                <CheckCircle className="text-success h-12 w-12" />
                <p className="text-foreground text-lg font-semibold">
                    Акаунт видалено
                </p>
                <p className="text-muted-foreground max-w-sm text-center text-sm">
                    Ваш акаунт деактивовано. Протягом 30 днів ви можете
                    відновити його — просто увійдіть до системи.
                </p>
                <UiButton
                    as="link"
                    href="/auth/signin"
                    variant="filled"
                    size="md"
                >
                    Увійти
                </UiButton>
            </div>
        );
    }

    if (status === 'error') {
        return (
            <div className="flex flex-col items-center gap-4">
                <p className="text-foreground text-lg">
                    Посилання недійсне або прострочене
                </p>
                <p className="text-muted-foreground text-sm">
                    {errorMessage ||
                        'Посилання для входу, яке ви використали, більше не дійсне. Будь ласка, запросіть нове.'}
                </p>
                <UiButton
                    as="link"
                    href="/auth/signin"
                    variant="filled"
                    size="md"
                >
                    Спробувати знову
                </UiButton>
            </div>
        );
    }

    return (
        <UiFullPageLoader
            message={
                status === 'success'
                    ? 'Перенаправлення…'
                    : 'Перевіряємо посилання…'
            }
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
