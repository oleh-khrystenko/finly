'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AxiosError } from 'axios';
import { CheckCircle } from 'lucide-react';
import type { AuthResponse } from '@finly/types';
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
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';

type VerifyStatus = 'verifying' | 'success' | 'deleted' | 'error';

/**
 * Sprint 10 §10.2 — claim-state-aware redirect-resolver. Викликається ПІСЛЯ
 * auth-finalization (`acceptTerms + getMe + setUser`). 4 гілки:
 *
 *  - `claimState === undefined` → fall-through на `redirectTarget` (backwards-
 *    compat зі Sprint 8: register/login/default без claim).
 *  - `'success'` → `clearAll()` + redirect на per-account з banner-trigger
 *    `?completed-from=landing`.
 *  - `'business-failed'` → `setFormData(failedClaimDraft)` +
 *    `setIntent('claim-failed-business')` + redirect на
 *    `/business/new?from=landing` (wizard pre-fill через `?from=landing`).
 *  - `'account-failed'` → setFormData + setIntent + redirect на
 *    `/business/{partialBusinessSlug}/account/new?from=landing`.
 *
 * `?redirect=` ігнорується для claim-flow — claim-target і generic-target
 * mutually exclusive.
 */
function handleClaimRedirect(
    response: AuthResponse,
    fallbackRedirect: string
): string {
    const store = useQrLandingDraftStore.getState();
    if (!response.claimState) return fallbackRedirect;

    if (
        response.claimState === 'success' &&
        response.claimedBusinessSlug &&
        response.claimedAccountSlug
    ) {
        store.clearAll();
        return `/business/${response.claimedBusinessSlug}/account/${response.claimedAccountSlug}?completed-from=landing`;
    }

    if (response.claimState === 'business-failed' && response.failedClaimDraft) {
        store.setFormData(response.failedClaimDraft);
        store.setIntent('claim-failed-business');
        return '/business/new?from=landing';
    }

    if (
        response.claimState === 'account-failed' &&
        response.failedClaimDraft &&
        response.partialBusinessSlug
    ) {
        store.setFormData(response.failedClaimDraft);
        store.setIntent('claim-failed-account');
        return `/business/${response.partialBusinessSlug}/account/new?from=landing`;
    }

    return fallbackRedirect;
}

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

                if ('deleted' in result) {
                    setStatus('deleted');
                    return;
                }

                // Auth-finalization безумовний для register / login / default —
                // потрібний user-store-hydration перед AuthGuard на target-page.
                // acceptTerms() — idempotent-no-op для claim-flow (Sprint 10
                // SP-12: backend уже stamp-нув terms ДО claim).
                await acceptTerms();
                const user = await getMe();
                useAuthStore.getState().setUser(user);
                setStatus('success');

                const target = handleClaimRedirect(result, redirectTarget);
                router.replace(target);
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
