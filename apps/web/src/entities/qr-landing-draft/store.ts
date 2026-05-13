import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { QrPreviewInput, QrPreviewResponse } from '@finly/types';

/**
 * Sprint 10 §SP-7/§SP-11 — granular intent state-machine для 2-sequential
 * claim-flow з form-recovery на failure.
 *
 *  - `idle` — стартовий стан, нічого не очікується.
 *  - `claim-pending` — користувач натиснув "Зберегти у кабінет" з лендінгу;
 *    після auth `useClaimLandingDraft` fires POST1.
 *  - `claim-business-pending` — POST1 (Business) в-польоті. На mount після
 *    crash/reload — recovery-toast + reset на `idle` (Sprint 10 §SP-7 tab-close
 *    resumption; backend dedup через `claimIdempotencyKey` гарантує, що
 *    свідомий retry не створить дублікат).
 *  - `claim-account-pending` — POST1 success, POST2 (Account) в-польоті. Така
 *    сама recovery-семантика.
 *  - `claimed` — claim-flow повністю завершився; після `clearAll()` повертається
 *    у `idle`. Post-success guard, щоб mount не повторив POST.
 *  - `claim-failed-business` — POST1 впав; backend повернув
 *    `claimState='business-failed'`. Recovery через `/business/new?from=landing`
 *    (wizard pre-fill з draft).
 *  - `claim-failed-account` — POST1 success, POST2 впав; backend повернув
 *    `claimState='account-failed'` + `partialBusinessSlug`. Recovery через
 *    `/business/{slug}/account/new?from=landing` (IBAN pre-fill).
 */
export type ClaimIntent =
    | 'idle'
    | 'claim-pending'
    | 'claim-business-pending'
    | 'claim-account-pending'
    | 'claimed'
    | 'claim-failed-business'
    | 'claim-failed-account';

interface QrLandingDraftState {
    formData: Partial<QrPreviewInput>;
    result: QrPreviewResponse | null;
    intent: ClaimIntent;
    /**
     * Sprint 10 §SP-11 — UUID v4, generated на CTA-click при транзиції
     * `idle → claim-pending`. Persisted, доживає до повного success обох POST
     * (тоді `clearAll()` повертає у `null`). Backend `BusinessesService.create`
     * дедуплікує через partial-unique-index `(ownerId, claimIdempotencyKey)`,
     * тож retry-after-tab-close НЕ створить дублікат бізнесу.
     */
    claimIdempotencyKey: string | null;
    setFormData: (patch: Partial<QrPreviewInput>) => void;
    setResult: (result: QrPreviewResponse) => void;
    invalidateResult: () => void;
    /**
     * Атомарна транзиція. При переході `idle → claim-pending` генерує
     * `claimIdempotencyKey` через `crypto.randomUUID()` (one-time stamp per
     * claim-attempt). Якщо ключ уже непорожній — лишається той самий
     * (recovery-cycle reuse того самого token-у). Інші транзиції не торкають
     * `claimIdempotencyKey`.
     */
    setIntent: (intent: ClaimIntent) => void;
    clearAll: () => void;
}

const STORAGE_KEY = 'finly:landing-draft';
/**
 * Sprint 8 → v1; Sprint 9 § 9.2 → v2 (defense-in-depth stale claim-intent для
 * QA-сесій до Sprint 9 deploy); Sprint 10 §10.2 → v3 (granular intent
 * state-machine + persisted `claimIdempotencyKey`).
 */
const STORAGE_VERSION = 3;

const INITIAL_STATE = {
    formData: {} as Partial<QrPreviewInput>,
    result: null as QrPreviewResponse | null,
    intent: 'idle' as ClaimIntent,
    claimIdempotencyKey: null as string | null,
};

/**
 * Sprint 8 §8.2 — Zustand-store з `persist`-middleware (localStorage).
 *
 * **localStorage, не sessionStorage**: landing-draft переживає закриття
 * вкладки. ФОП може заповнити форму, піти перевірити email, повернутись через
 * годину — дані мають бути на місці. `businessWizardStore` (sessionStorage)
 * живе у межах однієї auth-session-ії.
 *
 * **Окремий store від `businessWizardStore`**: anon-shape (`QrPreviewInput`:
 * 4 поля) і wizard-shape (`Partial<CreateBusinessRequest>` з ~11 полями) —
 * структурно різні. Persistence key різний (`finly:business-wizard`
 * sessionStorage vs `finly:landing-draft` localStorage). Sprint 10 розширення:
 * `intent` state-machine + `claimIdempotencyKey` живуть тут, бо це anon-claim
 * lifecycle, не wizard-state.
 *
 * **SSR-hydration mismatch**: `useQrLandingDraftStore` на SSR віддає
 * `INITIAL_STATE` (бо localStorage недоступний). Компоненти, що рендеряться
 * SSR, мусять використовувати `'use client'`-only обгортки.
 */
export const useQrLandingDraftStore = create<QrLandingDraftState>()(
    persist(
        (set) => ({
            ...INITIAL_STATE,
            setFormData: (patch) =>
                set((s) => ({ formData: { ...s.formData, ...patch } })),
            setResult: (result) => set({ result }),
            invalidateResult: () => set({ result: null }),
            setIntent: (intent) =>
                set((s) => {
                    if (
                        intent === 'claim-pending' &&
                        s.claimIdempotencyKey === null
                    ) {
                        return {
                            intent,
                            claimIdempotencyKey: crypto.randomUUID(),
                        };
                    }
                    return { intent };
                }),
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
                claimIdempotencyKey: s.claimIdempotencyKey,
            }),
            migrate: (persistedState, version) => {
                if (version === STORAGE_VERSION) {
                    return persistedState as Partial<QrLandingDraftState>;
                }

                // v2 → v3: формат formData ідентичний (QrPreviewInput.pick
                // полів). Зберігаємо user-data; intent проходить через
                // whitelist *тільки* benign-terminal-states ('idle' / 'claimed').
                // Усе інше (`'claim-pending'`, legacy `'claim-failed'`, будь-яке
                // *-pending) → reset на 'idle'.
                //
                // **Чому 'claim-pending' теж reset, не pass-through**: на v3
                // claim вимагає persisted `claimIdempotencyKey`, який v2 не
                // тримав. Pass-through дав би intent='claim-pending' +
                // claimIdempotencyKey=null — silent-stuck-state:
                // `resolveLandingClaimPayload` повертає {} через null-key, тож
                // магік-лінк не несе payload і backend claim не виконує;
                // `useClaimLandingDraft` early-return-ить на null-key. Без
                // UI-сигналу. Reset на 'idle' дає user-у можливість свідомо
                // натиснути CTA ще раз (новий ключ згенерується атомарно).
                if (version === 2 && isV2PersistedState(persistedState)) {
                    const legacyIntent = persistedState.intent;
                    const migratedIntent: ClaimIntent =
                        legacyIntent === 'idle' || legacyIntent === 'claimed'
                            ? legacyIntent
                            : 'idle';
                    return {
                        formData: persistedState.formData ?? {},
                        result: persistedState.result ?? null,
                        intent: migratedIntent,
                        claimIdempotencyKey: null,
                    };
                }

                // v1 або corrupted shape — reset на INITIAL_STATE (Sprint 9
                // §9.2 поведінка, fail-safe degrade).
                return { ...INITIAL_STATE };
            },
        }
    )
);

function isV2PersistedState(value: unknown): value is {
    formData?: Partial<QrPreviewInput>;
    result?: QrPreviewResponse | null;
    intent?: unknown;
} {
    return typeof value === 'object' && value !== null;
}
