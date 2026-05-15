import { z } from 'zod';

import { LandingDraftSchema } from './landing-draft';

/**
 * Sprint 13 §13 — shared contract для anon-claim 2-sequential flow. До Sprint 13
 * жив у `apps/api/src/modules/landing-claim/landing-claim.service.ts` як
 * api-internal type; результат склеювався у `AuthResponseSchema` через 5
 * плоских optional-полів. Тепер result — discriminated union у packages/types,
 * `AuthResponseSchema.claim` посилається на нього як single source of truth.
 *
 * Дискримінатор перейменовано з `claimState` (плоского-flat-shape ключа) на
 * `state` — після переїзду у вкладений `claim.*` об'єкт `claim-` prefix зайвий.
 */
export const LandingClaimResultSchema = z.discriminatedUnion('state', [
    z.object({
        state: z.literal('success'),
        claimedBusinessSlug: z.string(),
        claimedAccountSlug: z.string(),
    }),
    z.object({
        state: z.literal('business-failed'),
        failedClaimDraft: LandingDraftSchema,
    }),
    z.object({
        state: z.literal('account-failed'),
        partialBusinessSlug: z.string(),
        failedClaimDraft: LandingDraftSchema,
    }),
]);

export type LandingClaimResult = z.infer<typeof LandingClaimResultSchema>;
