'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

import {
    BusinessCreateForm,
    type BusinessCreateFormInitialValues,
} from '@/features/business-wizard';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';
import { useHasHydrated } from '@/shared/lib';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSpinner from '@/shared/ui/UiSpinner';

/**
 * Sprint 10 §10.2 — `?from=landing` query-param активує recovery-flow після
 * failure POST1 anon-claim. На цьому шляху форма pre-fill-ається з landing-
 * draft (`receiverName → name`, `purpose → paymentPurposeTemplate`,
 * `taxId → taxId`, тип фіксовано як `individual` — той самий контракт, який
 * `QrPreviewInputSchema` накладає на anon-форму).
 *
 * Hydration-gate на `useQrLandingDraftStore.persist.hasHydrated()` (через
 * `useHasHydrated`) обов'язковий: landing-store hydrate-ується асинхронно з
 * localStorage; читання `getState().formData` до hydration віддасть порожній
 * shape. Skeleton до hydration-complete.
 */
function BusinessNewContent() {
    const searchParams = useSearchParams();
    const fromLanding = searchParams.get('from') === 'landing';
    const hasHydrated = useHasHydrated(useQrLandingDraftStore);

    const initialValues = useMemo<
        BusinessCreateFormInitialValues | undefined
    >(() => {
        if (!fromLanding || !hasHydrated) return undefined;
        const draft = useQrLandingDraftStore.getState().formData;
        return {
            type: 'individual',
            name: draft.receiverName,
            taxId: draft.taxId,
            paymentPurposeTemplate: draft.purpose,
        };
    }, [fromLanding, hasHydrated]);

    if (fromLanding && !hasHydrated) {
        return (
            <UiPageContainer className="space-y-8 py-12 md:py-16">
                <UiPageHeading>Створення бізнесу</UiPageHeading>
                <div className="flex justify-center py-12">
                    <UiSpinner size="md" />
                </div>
            </UiPageContainer>
        );
    }

    return (
        <UiPageContainer className="space-y-8 py-12 md:py-16">
            <UiPageHeading>Створення бізнесу</UiPageHeading>
            <BusinessCreateForm
                initialValues={initialValues}
                fromLanding={fromLanding}
            />
        </UiPageContainer>
    );
}

export default function BusinessNewPage() {
    return (
        <Suspense
            fallback={
                <UiPageContainer className="space-y-8 py-12 md:py-16">
                    <UiPageHeading>Створення бізнесу</UiPageHeading>
                    <div className="flex justify-center py-12">
                        <UiSpinner size="md" />
                    </div>
                </UiPageContainer>
            }
        >
            <BusinessNewContent />
        </Suspense>
    );
}
