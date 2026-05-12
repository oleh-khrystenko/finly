import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { QrPreviewInput, QrPreviewResponse } from '@finly/types';

/**
 * Sprint 8 §8.2 — стан анонімного landing-draft-у:
 *
 *  - `idle` — стартовий стан, нічого не очікується.
 *  - `claim-pending` — користувач натиснув "Зберегти у кабінет"; після auth-у
 *    `useClaimLandingDraft` (§8.4) спрацює і створить бізнес.
 *  - `claimed` — claim-flow успішно завершився; після `clearAll()` повертається
 *    у `idle`. Окремий стан корисний як post-success guard, щоб case-tail не
 *    повторив POST на наступний mount/refresh.
 *  - `claim-failed` — claim-API повернув 4xx/5xx. Дані зберігаються у store
 *    (formData / result), Sprint 8 §8.5 показує "Продовжити чернетку з
 *    лендінгу" CTA в empty-state списку бізнесів.
 */
export type ClaimIntent = 'idle' | 'claim-pending' | 'claimed' | 'claim-failed';

interface QrLandingDraftState {
    formData: Partial<QrPreviewInput>;
    result: QrPreviewResponse | null;
    intent: ClaimIntent;
    setFormData: (patch: Partial<QrPreviewInput>) => void;
    setResult: (result: QrPreviewResponse) => void;
    invalidateResult: () => void;
    setIntent: (intent: ClaimIntent) => void;
    clearAll: () => void;
}

const STORAGE_KEY = 'finly:landing-draft';
/**
 * Sprint 9 §9.2 — bump 1→2 як defense-in-depth для stale `intent='claim-pending'`
 * у браузерах QA/dev-сесій, що до Sprint 9 deploy натиснули CTA "Зберегти у
 * кабінет" і закешували `formData`-shape під старий backend-contract. Sprint 9
 * видалив `requisites`-wrapper з `CreateBusinessSchema` — старий claim-payload
 * упреться у `.strict()` reject на 400. Migrate-handler нижче reset-ить state
 * на initial для unknown version, тож stale-payload не виконається.
 *
 * Sprint 10 при поверненні CTA з новою архітектурою bump-не version знову (2→3)
 * разом з shape-міграцією formData.
 */
const STORAGE_VERSION = 2;

const INITIAL_STATE = {
    formData: {} as Partial<QrPreviewInput>,
    result: null as QrPreviewResponse | null,
    intent: 'idle' as ClaimIntent,
};

/**
 * Sprint 8 §8.2 — Zustand-store з `persist`-middleware (localStorage).
 *
 * **Чому localStorage, не sessionStorage** (на відміну від `businessWizardStore`):
 * landing-draft має пережити закриття вкладки. ФОП може заповнити форму, піти
 * перевірити email, повернутись через годину — дані мають бути на місці.
 * Wizard у кабінеті працює інакше: він живе у межах однієї auth-session-ії,
 * sessionStorage достатньо.
 *
 * **Чому окремий store**, а не reuse `businessWizardStore` для anon-flow:
 * (1) anon-shape (`QrPreviewInput`: receiverName/iban/taxId/purpose) і wizard-
 * shape (`Partial<CreateBusinessRequest>` з 11 полями: type, requisites,
 * taxationSystem, isVatPayer, acceptedBanks…) — структурно різні. Reuse
 * вимагав би or-варіантів shape-у (state machine з discriminated union на
 * source). (2) Lifecycle різний: wizard reset-иться на `reset()` після submit;
 * landing-draft persist-ується крізь auth-flow до claim-у. (3) Persistence
 * key різний (`finly:business-wizard` sessionStorage vs `finly:landing-draft`
 * localStorage) — змішування у одному store ламало б invariant "одна крапка
 * правди — одне сховище".
 *
 * **Чому `partialize` явно фіксує persisted shape**: страхує від persist-у
 * нових (не-доменних) полів. Якщо у майбутньому додамо UI-state-only поля у
 * сам store (`isFormFocused` і т.д.) — вони не лізуть у localStorage без
 * явного дозволу. Дзеркалить pattern `businessWizardStore`.
 *
 * **Чому `migrate` reset-ить на unknown version**: graceful degrade при
 * downgrade-flow або corrupted localStorage. Втрата draft-у краще, ніж
 * runtime crash на rehydrate з incompatible shape.
 *
 * **SSR-hydration mismatch**: `useQrLandingDraftStore` на SSR віддає
 * `INITIAL_STATE` (бо localStorage недоступний). Компоненти, що рендеряться
 * SSR, мусять використовувати `useEffect`-pattern або `'use client'`-only
 * обгортки (Sprint 8 §8.3 `QrLandingBlock` — `'use client'` для цього).
 */
export const useQrLandingDraftStore = create<QrLandingDraftState>()(
    persist(
        (set) => ({
            ...INITIAL_STATE,
            setFormData: (patch) =>
                set((s) => ({ formData: { ...s.formData, ...patch } })),
            setResult: (result) => set({ result }),
            invalidateResult: () => set({ result: null }),
            setIntent: (intent) => set({ intent }),
            clearAll: () => set({ ...INITIAL_STATE }),
        }),
        {
            name: STORAGE_KEY,
            version: STORAGE_VERSION,
            storage: createJSONStorage(() => localStorage),
            partialize: (s) => ({
                formData: s.formData,
                result: s.result,
                intent: s.intent,
            }),
            migrate: (persistedState, version) => {
                if (version === STORAGE_VERSION) return persistedState;
                return { ...INITIAL_STATE };
            },
        }
    )
);
