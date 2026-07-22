# Sprint 10 — Operational Implementation Plan

> **Призначення:** декомпозиція `README.md` на 4 окремі коміти (по одному per епік). Source-of-truth — `README.md` і `planning-questions.md`; цей файл фіксує **порядок виконання**, **gate-критерії** і **межі коміт-ів**.

## Порядок епіків і залежності

```
10.0 Shared types          (БЛОКЕР №0 — стартує першим)
   └─→ 10.1 Backend        (depends on 10.0 published contracts + entity field)
         └─→ 10.2 Frontend (depends on 10.0 contracts + 10.1 endpoints)
               └─→ 10.3 Docs (finalization після всіх інших)
```

Лінійна ланцюжкова залежність — на відміну від Sprint 9, паралелізм неможливий: frontend читає `AuthResponseSchema.claimState` з backend і `LandingDraftSchema` з shared одночасно.

## Per-epic commit + downstream-build толерантність

Кожен епік — окремий коміт у feature-branch. Downstream-build (api/web) між 10.0 → 10.1 → 10.2 тимчасово ламається — це **навмисно**, симетрично Sprint 9 (`feedback_sprint-epic-commits`). Гриме окремий коміт ≠ green-CI-after-each-commit; CI стає зеленим у кінці 10.3.

---

## Епік 10.0 — Shared types (`@finly/types`)

### Скоуп

- Новий `packages/types/src/contracts/landing-draft.ts`:
    - `LandingDraftSchema = QrPreviewInputSchema.pick({ receiverName, iban, taxId, purpose })`.
    - `mapLandingDraftToCreateBusinessRequest(draft, claimIdempotencyKey): CreateIndividualBusinessRequest`.
- Рефакторинг `contracts/auth.ts`:
    - `SendMagicLinkSchema`: + `landingDraft.optional()`, `claimIdempotencyKey: z.string().uuid().optional()`, `termsVersion: z.string().optional()`; cross-field-refine `LANDING_DRAFT_AND_KEY_MUST_COEXIST`.
    - `AuthResponseSchema`: + 5 optional claim-fields (`claimState`, `claimedBusinessSlug`, `claimedAccountSlug`, `partialBusinessSlug`, `failedClaimDraft`); discriminator-refine на `claimState`.
- Рефакторинг `entities/business.ts`: + `claimIdempotencyKey?: string` (UUID v4).
- Рефакторинг `contracts/businesses.ts`: `claimIdempotencyKey` optional у base-fields усіх 4 variants `CreateBusinessSchema`; `UpdateBusinessSchema` і `PublicBusinessSchema` — без поля.
- Specs:
    - `landing-draft.spec.ts` — round-trip + mapping + UUID validation.
    - `auth.spec.ts` — claim-fields round-trip + cross-field refine + backwards-compat.
    - `business.spec.ts` оновити — idempotency-key optional.

### Gate-критерій

- `pnpm --filter @finly/types build` зелений.
- `pnpm --filter @finly/types test` зелений.
- Downstream `api`/`web` build навмисно ламаються — OK.

---

## Епік 10.1 — Backend (`apps/api`)

### Скоуп

- Новий `LandingClaimModule` + `LandingClaimService.attemptLandingClaim(ctx, draft, claimIdempotencyKey)` з 3-state response (`success` | `business-failed` | `account-failed`).
- `BusinessesService.create(userId, dto, isBookkeeperMode)` extension — pre-check на `claimIdempotencyKey` + 11000-replay через partial-unique-index `(ownerId, claimIdempotencyKey)`.
- `Business`-schema + `claimIdempotencyKey?: string` + sparse-compound-unique-index з `partialFilterExpression: { claimIdempotencyKey: { $type: 'string' } }`.
- `UsersService.stampAcceptedTerms(userId, version)` — idempotent на `$ne`-filter.
- `AuthService.sendMagicLink` — приймає 3 sibling-fields; dedup-overwrite з `KEEPTTL`.
- `AuthService.verifyMagicLink` — order-of-ops (auth → terms-stamp → claim → session); merge `claimState` у response.
- `AuthModule` імпортує `LandingClaimModule`.
- `config/env.ts` — fail-fast `AUTH_MAGIC_LINK_TTL_MIN * 60 ≥ AUTH_MAGIC_LINK_DEDUP_SEC`.
- Specs: 3 кейси `BusinessesService.create` + 5 кейсів `sendMagicLink` + 4 кейси `verifyMagicLink` + 3 кейси `stampAcceptedTerms` + 3 кейси `LandingClaimService`.

### Gate-критерій

- `pnpm --filter api build` зелений.
- `pnpm --filter api test` зелений.
- `pnpm --filter api -- jest ...` цільові spec-и зелені.
- Web build навмисно ламається — OK.

---

## Епік 10.2 — Frontend (`apps/web`)

### Скоуп

- Новий `shared/lib/useHasHydrated.ts` — generic move з `features/qr-landing-preview/lib/`; Sprint 8 callsite `QrLandingBlock` оновити на новий signature.
- `qrLandingDraftStore`:
    - Granular `intent`-state-machine (`'claim-business-pending' | 'claim-account-pending' | 'claim-failed-business' | 'claim-failed-account'`).
    - Persisted `claimIdempotencyKey: string | null` через `crypto.randomUUID()`.
    - Persist-migration v1→v2 (legacy `'claim-failed' → 'idle'`).
- `features/qr-landing-preview/api.ts`:
    - `createBusinessFromDraft(draft, claimIdempotencyKey)` — використовує shared-helper з 10.0.
    - `createAccountFromDraft(businessSlug, draft)`.
    - Видалити `claimLandingDraftAsBusiness` wrapper.
- `useClaimLandingDraft.ts` — 2 sequential POST + tab-close-resumption (reset на `claim-*-pending` mount).
- `app/(protected)/business/new/page.tsx` — `?from=landing` + hydration-gate + 3-step init `reset → setType('individual') → patchFormData`.
- `app/(protected)/business/[slug]/account/new/page.tsx` — `?from=landing` + hydration-gate + RHF `defaultValues.iban`.
- `app/auth/signin/page.tsx` — 4 call-site `sendMagicLink` mapping з runtime-conditional guard на `handleResend` (рядок 124).
- `app/auth/verify/page.tsx` — claimState-handler 4-branch post-finalization.
- `features/auth/AuthGuard.tsx` — auto-build `next` з `usePathname()` + `useSearchParams()`.
- `app/(protected)/profile/page.tsx` — `?next=` consume з open-redirect validation.
- Revert Sprint 9 CTA-hide на лендінгу (`QrLandingResult.tsx`).
- `shared/api/auth.ts` — `sendMagicLink` 4-й optional `options`-param.
- Specs: signin 6 + verify 6 + AuthGuard 3 + useHasHydrated 3 + `useClaimLandingDraft` regression.

### Gate-критерій

- `pnpm --filter web build` зелений.
- `pnpm --filter web test` зелений.
- `pnpm lint` без нових warnings.

### Split-trigger

Якщо коміт-diff перевищує ~20 файлів — розділити на 10.2a (store + hooks + api + useHasHydrated) і 10.2b (pages + signin + verify + AuthGuard + CTA-revert). За дефолтом — один коміт.

---

## Епік 10.3 — Docs

### Скоуп

- `CLAUDE.md`:
    - Module Dependency Map: + `LandingClaimModule` (depends on `BusinessesModule` + `AccountsModule`, imported by `AuthModule`).
    - Known Complexities: 4 нових пункти — Sprint 10 claim-flow architecture, magic-link dedup × landingDraft overwrite з `KEEPTTL`, `Business.claimIdempotencyKey` partial-unique-index, terms-pre-stamp у verifyMagicLink.
- `docs/manual-checks/README.md`: CLAIM-1..7 UAT-пункти.

### Gate-критерій

- Documentation review pass (manual).

---

## Definition of Done (level Sprint)

Дублює `README.md §Definition of Done`. Цей файл його не перевизначає — посилання для зручності читача.
