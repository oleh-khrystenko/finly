# Sprint 11 — Deep-link UX-recovery після abandoned magic-link claim

> **Статус (на 2026-05-11):** заплановано, не стартував.
> **Передумови:** Sprint 9 (Account-схема), Sprint 10 (`LandingClaimService.attemptLandingClaim` повертає `claimState='success'` з канонічними `claimedBusinessSlug + claimedAccountSlug`). Усі — функціонально закриті.
> **Що розблокує:** UX-завершеність anon-claim flow для cold-login-сценарію (phone-юзер закрив таб до verify-response, повертається через день — потрапляє на ту саму per-account-page з banner-ом, що бачив би при same-device flow); закриває першу частину Risk #14 з Sprint 9 (deep-link UX-recovery; Sprint 12 закриває другу частину — automatic cleanup).
> **Контекст рішень:** вступний контракт і архітектурні рішення — у [`planning-questions.md`](planning-questions.md). Цей README — імплементаційна механіка.
> **Production-data:** ще немає. Якщо до моменту імплементації Sprint 11 dev-environment-и матимуть тестові User-документи Sprint 9-10 — dropDatabase + чистий старт.

---

## Мета

Зробити anon-claim flow resilient проти "tab-closed-before-router-replace" edge-case:

1. Backend на success-claim stamps `user.pendingPostLoginTarget = /business/{businessSlug}/account/{accountSlug}?completed-from=landing` (single source of truth для post-claim deep-link).
2. Same-device-flow (юзер дочекався verify-response) — verify-page-handler clear-ить stamp synchronously ДО `router.replace` claim-target-у (вже відомий з response). AuthInitializer на target-page бачить null і не interferes.
3. Cold-login-flow (юзер закрив таб ДО verify-response, повертається через день/тиждень) — на наступному свідомому login-у `AuthInitializer` ловить stamped target, робить `clearPendingPostLoginTarget()` first (one-time-use idempotency) + `router.replace(target)`. Юзер потрапляє на ту саму per-account-page з banner-ом `?completed-from=landing` — UX-completeness збережено.
4. Open-redirect-protection двошарова: backend на write valid-path-only; frontend на read valid-path-only. Single source of truth — shared `validateSameOriginPath`-helper.

---

## Скоуп

### Backend (`apps/api`)

- 🔲 `apps/api/src/modules/users/schemas/user.schema.ts` — додати `@Prop({ type: String, required: false }) pendingPostLoginTarget?: string` (sparse — більшість users ніколи не торкають це поле). **Без sparse-index** — поле read-ається тільки через `getMe()` per-user-flow (без queries-by-target); cron не sort-ить за ним.
- 🔲 `apps/api/src/modules/users/users.service.ts` — два нові methods:
    - `setPendingPostLoginTarget(userId, target)` — runtime validation через shared-helper `validateSameOriginPath(target)` (Shared deliverable нижче); throw `BadRequestException({ code: 'INVALID_REDIRECT_TARGET' })` на invalid path; інакше `User.updateOne({ _id }, { $set: { pendingPostLoginTarget: target } })`.
    - `clearPendingPostLoginTarget(userId)` — `User.updateOne({ _id }, { $unset: { pendingPostLoginTarget: 1 } })`. Викликається frontend через існуючий `PATCH /users/me`-endpoint з body `{ pendingPostLoginTarget: null }` (existing endpoint розширюється на nullable-clear; symmetric до решти `PATCH`-fields). Direct service-method теж викликається з cron Stage 3 (Sprint 12 deliverable) на cleanup.
- 🔲 `apps/api/src/modules/users/users.controller.ts` — `PATCH /users/me` розширити на `pendingPostLoginTarget: null` (nullable-clear). `UpdateUserSchema` (`packages/types/src/contracts/users.ts`) додає optional nullable-string. **На write з non-null value frontend не передає** — це backend-only stamp; PATCH-endpoint приймає тільки `null` як explicit clear-action. Безпека: на non-null value frontend-request → reject `400 INVALID_REDIRECT_TARGET` (frontend не має причини set-ити цей field; це anti-injection-rule).
- 🔲 **`LandingClaimService.attemptLandingClaim` extension** (Sprint 10 deliverable розширюється у цьому спринті) — на success-claim після `BusinessesService.create` + `AccountsService.create` робить **`UsersService.setPendingPostLoginTarget(user._id, '/business/{businessSlug}/account/{accountSlug}?completed-from=landing')`** ВСЕРЕДИНІ LandingClaimService (не у `AuthService.verifyMagicLink`), щоб responsibility-bundle тримався разом з claim-success-flow. **`LandingClaimModule` import-ить `UsersModule`** для injected-`UsersService` (новий dep edge; не cycle-breaking — Auth ↔ Users existing forwardRef-розв'язок зберігається без змін; LandingClaim-граф залишається directed-acyclic).
- 🔲 Spec на `UsersService.setPendingPostLoginTarget`: 4 кейси — (a) valid path → write; (b) invalid path (no leading `/`) → throw; (c) protocol-prefixed (`http://attacker.com`) → throw; (d) double-slash-prefixed (`//attacker.com`) → throw.
- 🔲 Spec на `LandingClaimService.attemptLandingClaim` (extension): success-flow тепер додатково перевіряє stamp-у на user-doc через `UsersService.findById(userId)` post-claim.

### Frontend (`apps/web`)

- 🔲 **`apps/web/src/features/auth/AuthInitializer.tsx` розширюється** — на login-mount, після `getMe()` resolve і `setUser(me)` пасу, **перед** будь-яким стороннім redirect-flow-ом (наприклад, перед AuthGuard-redirect-цепочкою) перевіряє `me.pendingPostLoginTarget`:
    - Якщо null/undefined — no-op (стандартний flow Sprint 8 baseline).
    - Якщо non-null:
        1. Defense-in-depth validation через shared-helper `validateSameOriginPath(target)` (Shared deliverable нижче). На invalid path → `console.warn` + `clearPendingPostLoginTarget()` (виклик `PATCH /users/me { pendingPostLoginTarget: null }` через existing `shared/api/users.ts`-helper) + skip redirect (стандартний flow). Backend-side validation на write вже мав це не пропустити, але defense-in-depth ловить race-edge "поле відрендерилось у відповіді з невалідним value через прямий БД-edit на dev-environment-i".
        2. На valid path — synchronously `await clearPendingPostLoginTarget()` first (one-time-use; на failure clear-у — silent log warn, не блокує redirect), потім `router.replace(target)`. Order "clear-before-redirect" критичний: redirect міняє route → AuthInitializer re-mount-ить → читає `pendingPostLoginTarget` знову → infinite-loop. Clear-first гарантує idempotency.
    - Spec на `AuthInitializer.spec.tsx` 4 нові кейси: (a) no `pendingPostLoginTarget` → нічого не відбувається; (b) valid path → clear + replace; (c) invalid path (`//attacker.com`) → warn + clear + skip-redirect; (d) clear-API-failure → warn + redirect все одно (clear не блокує UX).
- 🔲 **`apps/web/src/app/auth/verify/page.tsx` — same-device pendingPostLoginTarget consume**. Sprint 10 deliverable розширюється: одразу після `setUser(me)` і ПЕРЕД `router.replace(...)` (для будь-якої `claimState` гілки, включно з не-claim flow) — `void clearPendingPostLoginTarget().catch(logWarn)` (fire-and-forget, бо clear-failure не повинен ламати UX-redirect). Це гарантує, що backend-stamped target не вистрелить як stale-redirect через AuthInitializer на наступному cold-login. Якщо `me.pendingPostLoginTarget === null` (rare — backend stamp не виконався з якоїсь причини, наприклад validation-throw або failure post-stamp) — clear-call no-op-ить за тим самим filter-pattern на backend; benign.
- 🔲 **`apps/web/src/shared/api/users.ts` — новий API-helper `clearPendingPostLoginTarget()`** — thin wrapper над `PATCH /users/me` з body `{ pendingPostLoginTarget: null }`; envelope-unwrap; no return-shape. Reuse existing `patchProfile`-pattern (якщо існує) або додає окремий helper symmetric до решти PATCH-helpers.
- 🔲 Spec на verify-page-handler: 1 додатковий регресійний кейс — verify-success-flow робить `clearPendingPostLoginTarget()` до `router.replace`, незалежно від `claimState`. Existing 6 кейсів зі Sprint 10 verify-page spec — без змін.

### Shared (`@finly/types`)

- 🔲 `packages/types/src/utils/path.ts` — новий shared-helper `validateSameOriginPath(target: string): boolean`. Rules: `target.startsWith('/') && !target.startsWith('//') && !/^https?:\/\//.test(target) && !/^\/\//.test(target)`. Returns boolean (не throw). Caller-и обирають як обробляти invalid path (backend → throw, frontend → log+skip).
- 🔲 `packages/types/src/entities/user.ts` — додати `pendingPostLoginTarget: z.string().refine(validateSameOriginPath, { message: 'INVALID_REDIRECT_TARGET' }).optional()` (single source of truth для path-safety-rule — reuse helper з `utils/path.ts`).
- 🔲 `packages/types/src/contracts/users.ts` — `UpdateUserSchema` додати optional nullable `pendingPostLoginTarget: z.literal(null).optional()` (тільки `null` приймається на write через PATCH — frontend stamp-ити не може; backend stamp-ить напряму через service-method без проходу через DTO).
- 🔲 Spec round-trip `user.spec.ts`: новий кейс — valid path round-trip + invalid path reject; `path.spec.ts`: позитивні і negative кейси (5 кожен — `/business`, `/business?next=foo`, `/profile/me` valid; `//evil.com`, `http://evil.com`, `https://evil.com`, `evil.com`, empty string invalid).

### Cross-cutting docs

- 🔲 `CLAUDE.md`:
    - Domain Model — `User` додати `pendingPostLoginTarget`-поле опціонально.
    - Known Complexities — новий пункт "pendingPostLoginTarget single-stamp-and-clear pattern: write-once on claim-success, consume-and-clear на verify-handler (same-device) OR AuthInitializer (cold-login); двошарова open-redirect-protection через shared validateSameOriginPath".
- 🔲 `docs/manual-checks/README.md` — нові UAT-пункти:
    - **DEEP-1 — Same-device claim з deep-link clearance.** Anon на десктопі вводить дані на лендінгу → "Зберегти у кабінет" → magic-link для нового user-а. Відкрити email на тому самому десктопі (same browser) → клікнути magic-link → verify-page → autoflow на `/business/{biz}/account/{acc}?completed-from=landing` з banner-ом. Перевірити: у user-doc-у через staging-API `GET /users/me` field `pendingPostLoginTarget === null` (cleared verify-handler-ом). На refresh per-account-page banner лишається, `pendingPostLoginTarget` lишається null.
    - **DEEP-2 — Cold-login resume через AuthInitializer.** Та сама anon-сесія: вводить дані → magic-link для нового user-а. Email клікнути, але **закрити browser-tab ДО завершення verify-page-redirect-у** (тригернути network-throttling або swipe-close-tab у ~100ms-window після click). Backend на staging — verify-endpoint все одно виконав claim і stamp-нув pendingPostLoginTarget. Через 1 день свідомо повернутися на `finly.com.ua/signin` → ввести email → пройти password-flow → AuthInitializer-resume → URL у браузері змінюється на `/business/{biz}/account/{acc}?completed-from=landing` (вже з banner-ом). Перевірити: staging-API `GET /users/me` після redirect-у показує `pendingPostLoginTarget === null` (cleared AuthInitializer-ом).
    - **DEEP-3 — Open-redirect protection.** Через staging-CLI напряму у БД set-нути `user.pendingPostLoginTarget = "https://attacker.com"` (bypass backend validation). Login → AuthInitializer читає stamped target → defense-in-depth check fail-ить → `console.warn` у browser-dev-tools + clear-call виконано + redirect-skip (юзер потрапляє на дефолтний cabinet-root, не на evil.com).

---

## НЕ-скоуп

- ❌ **Orphan-Business cleanup-cron + email-pipeline** — Sprint 12 deliverable. Sprint 11 фокусується тільки на pendingPostLoginTarget UX-recovery.
- ❌ **pendingPostLoginTarget для не-claim flow-ів** (наприклад, "запам'ятай, де я був, і поверни мене туди після Google OAuth"). AuthGuard уже має автоматичну побудову `next` з поточного URL (Sprint 10 §9.4 deliverable) — це покриває incomplete-profile-deep-link-flow без stamp-у. `pendingPostLoginTarget` свідомо живе тільки для claim-flow, бо там user не контролює target (backend його генерує).
- ❌ **Multi-stamp queue** ("якщо було кілька claim-attempt-ів — зберігай всі target-и і покажи перший на cold-login"). Один stamp за один claim; новий stamp overwrites попередній. Якщо user намагається кілька разів зробити claim з різних таб-ів — stamp matches останній success. Multi-stamp queue — overengineering.
- ❌ **`pendingPostLoginTarget` TTL / auto-expiration**. Stamp живе у user-doc-у до consume-call-у або до Stage 3 cleanup (Sprint 12). Якщо user повертається через місяць — stamp все одно валідний (target-page існує, бо Stage 3 cleanup ще не відбувся за тиждень). Якщо Stage 3 cleanup відбувся ДО cold-login — `clearPendingPostLoginTarget()` Sprint 12 deliverable ловить це разом з cascade-deletion.
- ❌ **Frontend-side persistence pendingPostLoginTarget у localStorage / sessionStorage**. Stamp живе тільки backend-side; cross-device-resume працює природньо через user-doc-у.

---

## Епіки

### 11.0 Shared types — User.pendingPostLoginTarget + validateSameOriginPath helper

- 🔲 `packages/types/src/utils/path.ts` — `validateSameOriginPath` helper + spec.
- 🔲 `packages/types/src/entities/user.ts` — додати `pendingPostLoginTarget` optional з refine на helper.
- 🔲 `packages/types/src/contracts/users.ts` — `UpdateUserSchema` приймає `null` на clear.
- 🔲 **Acceptance:** `pnpm --filter @finly/types build` зелений; `pnpm --filter @finly/types test` зелений.

### 11.1 Backend — User field + UsersService methods + LandingClaimService stamp

- 🔲 `User.pendingPostLoginTarget` Mongoose-схема.
- 🔲 `UsersService.setPendingPostLoginTarget` + `clearPendingPostLoginTarget` методи з runtime-validation через helper.
- 🔲 `PATCH /users/me` приймає `pendingPostLoginTarget: null` для frontend-clear.
- 🔲 `LandingClaimService.attemptLandingClaim` extension — stamps target на success-claim.
- 🔲 `LandingClaimModule` import-ить `UsersModule` (new dep edge; not cycle-breaking).
- 🔲 Spec-кейси: UsersService validation 4 кейси + LandingClaimService stamp regression.

### 11.2 Frontend — AuthInitializer cold-login resume + verify-page same-device clear

- 🔲 `AuthInitializer` розширюється для read+clear+replace flow.
- 🔲 `apps/web/src/app/auth/verify/page.tsx` додає `clearPendingPostLoginTarget` fire-and-forget call.
- 🔲 `shared/api/users.ts` — `clearPendingPostLoginTarget` thin-wrapper.
- 🔲 Spec: AuthInitializer 4 нові кейси + verify-page 1 регресійний кейс.

### 11.3 Cross-cutting docs

- 🔲 `CLAUDE.md` оновлений (Domain Model + Known Complexities).
- 🔲 `docs/manual-checks/README.md` нові UAT-пункти DEEP-1..3.

---

## Risks / Known Complexities

- **Ризик 1 — `AuthInitializer` `triedRef`-block** для cold-login flow може зачепити edge: user логіниться на десктопі (session A, `triedRef.current = true` set-нуто), залишає таб відкритим на день, потім свідомо robить magic-link-claim з phone (session B), повертається на десктоп → AuthInitializer на session A НЕ re-mount-ить (page-cache в browser). pendingPostLoginTarget на user-doc-у lishitsya stamped. Mitigation: цей edge не критичний — на наступний browser-restart session A гасне, `triedRef` starts fresh, claim-target resume працює; **до того моменту stamp benign-stays на user-doc-у**. У telemetry-driven Sprint 13+ можна додати window-message-bus для in-tab AuthInitializer-rerun, якщо проблема стане відчутною.
- **Ризик 2 — Stamp пережив Stage 3 cleanup без явного clear**. Sprint 12 cron Stage 3 cascade-deletion-flow робить `clearPendingPostLoginTarget(userId)` після reset reminders (Sprint 12 deliverable §SP-13 part 4). Якщо cron crash-ить між cascade-delete і clear — user-doc лишається з stamped target на business-slug, який вже видалений. На наступному cold-login AuthInitializer-resume → 404 на target-page. Mitigation: на 404-page (Next.js `not-found.tsx`) — `clearPendingPostLoginTarget` fire-and-forget + банер "Сторінку не знайдено, повертаємо до cabinet root". UAT-кейс — Sprint 12 ORPHAN-3 розширюється на post-deletion login regression.
- **Ризик 3 — Open-redirect через React-state-injection.** Зловмисник, що отримав XSS на frontend, може set-ити `useAuthStore.getState().user.pendingPostLoginTarget = "https://evil.com"` через `setUser`-store-action. AuthInitializer на наступному re-render не call-ить `getMe()` повторно (state read directly зі store), а read-ить stamped value напряму. Defense-in-depth `validateSameOriginPath` на frontend ловить це — log warn + clear-skip. Mitigation: shared-helper invariant зберігає захист навіть на XSS-bypass-сценаріях; primary XSS-захист — CSP-headers і Next.js default escaping, не торкаються Sprint 11 scope.
- **Ризик 4 — Backwards-compat для existing users без `pendingPostLoginTarget`-поля.** Sprint 9 invariant — production-data ще немає, dropDatabase. Якщо до моменту deploy Sprint 11 у БД виявляться legacy User-документи без поля — Mongoose default-undefined спрацює; `getMe()` повертає user без field; AuthInitializer no-op-ить. Безпечно.

---

## Definition of Done

- ✅ Усі епіки 11.0..11.3 закриті.
- ✅ `pnpm test` зелений по всіх workspace-ах:
    - `@finly/types` — `path.spec.ts` + `user.spec.ts` (round-trip valid + invalid path) + `users.spec.ts` (UpdateUserSchema приймає null) усі зелені.
    - `apps/api` — `UsersService.spec.ts` 4 нові кейси + `LandingClaimService.spec.ts` stamp regression.
    - `apps/web` — `AuthInitializer.spec.tsx` 4 нові кейси + verify-page-spec 1 регресійний кейс.
- ✅ `pnpm lint` без нових warnings.
- ✅ `pnpm build` всіх workspace-ів success.
- ✅ Smoke-test на staging:
    - Anon-claim flow same-device → verify-handler clears stamp → no AuthInitializer-resume on next session.
    - Anon-claim flow з симуляцією tab-close-mid-redirect → cold-login → AuthInitializer-resume на правильний per-account-page з banner-ом.
- ✅ UAT manual-checks DEEP-1..3 — статус ⬜ → ✅ або документований negative-result з ticket-ом.
- ✅ `CLAUDE.md` оновлений (Domain Model + Known Complexities).
- ✅ Перша частина Ризику #14 з Sprint 9 (deep-link UX-recovery) — позначена як closed-by-design з посиланням на Sprint 11 README у Sprint 9 Risks-секції. Друга частина (automatic cleanup) — закривається у Sprint 12.
