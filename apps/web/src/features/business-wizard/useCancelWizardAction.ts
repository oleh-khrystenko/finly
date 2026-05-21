'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';
import { useBusinessWizardStore } from './businessWizardStore';

/**
 * Спільна cancel-action для wizard-у — єдина точка істини, яку використовують
 * і header-кнопка (skip-on-empty branch), і `CancelBusinessWizardDialog`
 * (confirm-branch). Дублювання side-effects у двох callsite-ах ламало б
 * інваріант "abandon flow = чистий wizard + чистий landing-draft".
 *
 * Side-effects:
 *  1. `reset()` wizard-стору (sessionStorage чиститься через `partialize`).
 *  2. Якщо wizard відкритий у recovery-flow `?from=landing` — `clearAll()`
 *     landing-draft store. Без цього `useClaimLandingDraft` міг би
 *     підхопити stale `claim-failed-business`-intent при наступному
 *     auth-mount-i.
 *  3. Redirect на `/business`.
 */
export function useCancelWizardAction(): () => void {
    const router = useRouter();
    const searchParams = useSearchParams();
    const fromLanding = searchParams.get('from') === 'landing';

    return useCallback(() => {
        useBusinessWizardStore.getState().reset();
        if (fromLanding) {
            useQrLandingDraftStore.getState().clearAll();
        }
        router.push('/business');
    }, [router, fromLanding]);
}
