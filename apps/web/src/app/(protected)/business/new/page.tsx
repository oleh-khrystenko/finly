'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSpinner from '@/shared/ui/UiSpinner';
import { useHasHydrated } from '@/shared/lib';
import { BusinessWizardForm } from '@/features/business-wizard';
import { useBusinessWizardStore } from '@/features/business-wizard/businessWizardStore';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';

/**
 * Sprint 10 §10.2 — wizard-page приймає `?from=landing` query-param для
 * recovery-flow після failure POST1 anon-claim. Pre-fill через 3-step init:
 *
 *   1. `reset()` — стерти будь-який stale wizard-state з попередньої сесії.
 *   2. `setType('individual')` — landing-форма фіксує тип на фізособі
 *      (`QrPreviewInputSchema` rationale у Sprint 8); recovery зберігає той
 *      самий тип, не дає вибрати інший на recovery-path.
 *   3. `patchFormData({ name, taxId, paymentPurposeTemplate })` — підставити
 *      landing-fields у wizard-shape (mapping `receiverName → name`,
 *      `purpose → paymentPurposeTemplate`).
 *
 * Hydration-gate на `useQrLandingDraftStore.persist.hasHydrated()` (через
 * shared `useHasHydrated`-hook) обов'язковий: landing-store hydrate-ється
 * асинхронно з localStorage; 3-step init ДО hydration читав би порожній
 * `formData`. Skeleton до hydration-complete.
 *
 * **3-step init fires виключно у `?from=landing`-branch + рівно один раз
 * post-hydrate** через `initFiredRef`. На стандартний flow (без query-param)
 * wizard-page рендериться як `<BusinessWizardForm />` без жодних store-mutate.
 */
function BusinessNewContent() {
    const searchParams = useSearchParams();
    const fromLanding = searchParams.get('from') === 'landing';
    const hasHydrated = useHasHydrated(useQrLandingDraftStore);
    const initFiredRef = useRef(false);
    const [initDone, setInitDone] = useState(!fromLanding);

    useEffect(() => {
        if (!fromLanding) return;
        if (!hasHydrated) return;
        if (initFiredRef.current) return;
        initFiredRef.current = true;

        const draft = useQrLandingDraftStore.getState().formData;
        const wizard = useBusinessWizardStore.getState();
        wizard.reset();
        wizard.setType('individual');
        wizard.patchFormData({
            name: draft.receiverName,
            taxId: draft.taxId,
            paymentPurposeTemplate: draft.purpose,
        });
        setInitDone(true);
    }, [fromLanding, hasHydrated]);

    if (fromLanding && !initDone) {
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
            <BusinessWizardForm />
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
