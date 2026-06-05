'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { AxiosError } from 'axios';
import {
    getApiMessage,
    getBusinessBySlug,
} from '@/shared/api';
import type { BusinessWithCounts } from '@finly/types';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import UiButton from '@/shared/ui/UiButton';
import { useHasHydrated } from '@/shared/lib';
import { AccountCreateForm } from '@/features/account-create';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';

/**
 * Sprint 9 §9.2 — route `/business/{slug}/account/new`. Single-form для
 * створення Account під бізнесом.
 *
 * Sprint 10 §10.2 — приймає `?from=landing` для anon-claim recovery flow:
 *  - hydration-gate на `useQrLandingDraftStore` (через shared `useHasHydrated`-
 *    hook) — landing-store hydrate-ється асинхронно з localStorage; pre-fill
 *    IBAN до hydration-complete зчитав би порожній snapshot.
 *  - На submit success — `AccountCreateForm` сам читає prefillIban з prop-у;
 *    success-redirect на per-account-page + landing-draft cleanup
 *    (`clearAll`) робиться там же.
 */
interface LoadedData {
    paramSlug: string;
    business: BusinessWithCounts;
}

interface ErrorState {
    paramSlug: string;
    message: string;
}

function NewAccountContent() {
    const params = useParams<{ slug: string }>();
    const searchParams = useSearchParams();
    const fromLanding = searchParams.get('from') === 'landing';
    const hasHydrated = useHasHydrated(useQrLandingDraftStore);
    const paramSlug = params.slug;
    const [data, setData] = useState<LoadedData | null>(null);
    const [error, setError] = useState<ErrorState | null>(null);

    useEffect(() => {
        if (!paramSlug) return;
        let cancelled = false;
        getBusinessBySlug(paramSlug)
            .then((b) => {
                if (cancelled) return;
                setData({ paramSlug, business: b });
                setError(null);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const code =
                    err instanceof AxiosError
                        ? ((
                              err.response?.data as
                                  | { error?: { code?: string } }
                                  | undefined
                          )?.error?.code ?? 'unknown')
                        : 'unknown';
                setError({
                    paramSlug,
                    message: getApiMessage(code, 'businesses'),
                });
            });
        return () => {
            cancelled = true;
        };
    }, [paramSlug]);

    const isDataCurrent = data?.paramSlug === paramSlug;
    const isErrorCurrent = error?.paramSlug === paramSlug;

    // Hydration-gate активний лише на ?from=landing-branch (стандартний flow
    // не торкає store і render-иться одразу).
    if (fromLanding && !hasHydrated) {
        return (
            <UiPageContainer className="py-16">
                <div className="flex justify-center">
                    <UiSpinner size="md" />
                </div>
            </UiPageContainer>
        );
    }

    if (!isDataCurrent && !isErrorCurrent) {
        return (
            <UiPageContainer className="py-16">
                <div className="flex justify-center">
                    <UiSpinner size="md" />
                </div>
            </UiPageContainer>
        );
    }

    if (isErrorCurrent && error) {
        return (
            <UiPageContainer className="space-y-6 py-12">
                <UiSectionCard title={error.message}>
                    <p className="text-muted-foreground mt-2 text-sm">
                        Поверніться до бізнесу і повторіть.
                    </p>
                    <div className="mt-4">
                        <UiButton
                            as="link"
                            href="/business"
                            variant="filled"
                            size="md"
                            IconLeft={<ArrowLeft />}
                        >
                            До списку бізнесів
                        </UiButton>
                    </div>
                </UiSectionCard>
            </UiPageContainer>
        );
    }

    if (!isDataCurrent || !data) return null;
    const { business } = data;
    const prefillIban = fromLanding
        ? useQrLandingDraftStore.getState().formData.iban
        : undefined;

    return (
        <UiPageContainer className="space-y-6 py-8 md:py-12">
            <UiPageHeading>Додати реквізити</UiPageHeading>
            <AccountCreateForm
                businessSlug={business.slug}
                prefillIban={prefillIban}
                landingRecovery={fromLanding}
            />
        </UiPageContainer>
    );
}

export default function NewAccountPage() {
    return (
        <Suspense
            fallback={
                <UiPageContainer className="py-16">
                    <div className="flex justify-center">
                        <UiSpinner size="md" />
                    </div>
                </UiPageContainer>
            }
        >
            <NewAccountContent />
        </Suspense>
    );
}
