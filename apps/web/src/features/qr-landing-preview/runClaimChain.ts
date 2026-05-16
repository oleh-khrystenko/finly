import { AxiosError } from 'axios';
import { toast } from 'sonner';
import type { LandingDraft, QrPreviewInput } from '@finly/types';

import type { ClaimIntent } from '@/entities/qr-landing-draft';
import { getApiMessage } from '@/shared/api/mapApiCode';

import { createAccountFromDraft, createBusinessFromDraft } from './api';

/**
 * Structural-minimal subset of Next `useRouter()` — лише `replace`. Декаплює
 * helper від Next-internal type-export-ів і робить його тестованим без
 * mocking-у `next/navigation`.
 */
interface RouterLike {
    replace: (href: string) => void;
}

export interface ClaimChainContext {
    setIntent: (intent: ClaimIntent) => void;
    setFormData: (patch: Partial<QrPreviewInput>) => void;
    clearAll: () => void;
    router: RouterLike;
    /**
     * Optional — RHF `form.reset` на success-path для inline-CTA у
     * `QrLandingResult`. `useClaimLandingDraft` не оперує формою і передає
     * undefined.
     */
    onSuccessFormReset?: () => void;
}

/**
 * Sprint 10 §10.2 — shared 2-sequential anon-claim chain. Викликається з двох
 * callsite-ів:
 *
 *  1. `useClaimLandingDraft` — після auth-finalization (magic-link verify
 *     або Google OAuth complete) з persisted `intent='claim-pending'`.
 *  2. `QrLandingResult.handleClaim` — inline для logged-in користувача, що
 *     натиснув CTA "Зберегти у кабінет" безпосередньо на лендінгу.
 *
 * **Single source of truth** для:
 *   - intent state-machine progression (`claim-business-pending` →
 *     `claim-account-pending` або failure-states),
 *   - failure-recovery redirect-targets (`/business/new?from=landing` або
 *     `/business/{slug}/account/new?from=landing`),
 *   - error-message mapping ('businesses' / 'accounts' modules),
 *   - cleanup на success (`clearAll` landing-store + optional `form.reset`).
 *
 * Caller відповідає за свої side-effects (`inProgressRef`, `setIsClaiming`)
 * ДО і ПІСЛЯ виклику.
 */
export async function runClaimChain(
    draft: LandingDraft,
    claimIdempotencyKey: string,
    ctx: ClaimChainContext
): Promise<void> {
    let businessSlug: string;
    try {
        ctx.setIntent('claim-business-pending');
        const business = await createBusinessFromDraft(
            draft,
            claimIdempotencyKey
        );
        businessSlug = business.slug;
    } catch (err) {
        ctx.setFormData(draft);
        ctx.setIntent('claim-failed-business');
        toast.error(getApiMessage(extractAxiosCode(err), 'businesses'));
        ctx.router.replace('/business/new?from=landing');
        return;
    }

    try {
        ctx.setIntent('claim-account-pending');
        const account = await createAccountFromDraft(businessSlug, draft);
        // **Order matters** (Sprint 10 review fix): спершу form-reset (RHF
        // `form.watch`-subscriber у `QrLandingBlock` синхронно тригериться на
        // `form.reset` і пише EMPTY_FORM_VALUES назад у store), а вже потім
        // `clearAll()` — який фінально wipes-ить formData назад на `{}`.
        // Реверс послідовності leakнув би EMPTY-snapshot у persisted store
        // одразу після нібито повного `clearAll`.
        ctx.onSuccessFormReset?.();
        ctx.clearAll();
        toast.success('Бізнес і рахунок збережено');
        ctx.router.replace(
            `/business/${businessSlug}/account/${account.slug}?completed-from=landing`
        );
    } catch (err) {
        ctx.setFormData(draft);
        ctx.setIntent('claim-failed-account');
        toast.error(getApiMessage(extractAxiosCode(err), 'accounts'));
        ctx.router.replace(
            `/business/${businessSlug}/account/new?from=landing`
        );
    }
}

function extractAxiosCode(err: unknown): string {
    if (err instanceof AxiosError) {
        const payload = err.response?.data as
            | { error?: { code?: string } }
            | undefined;
        return payload?.error?.code ?? 'unknown';
    }
    return 'unknown';
}
