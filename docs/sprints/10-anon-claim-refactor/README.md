# Sprint 10 — Anon-claim refactor під Business + Account модель

> **Статус (на 2026-05-11):** заплановано, не стартував.
> **Передумови:** Sprint 9 (Account-схема, AccountsModule, cabinet+public flow готові; CTA "Зберегти у кабінет" на лендінгу тимчасово вимкнена в кінці Sprint 9). Sprint 8 — функціонально закритий (anon-preview + persist + Google OAuth claim-flow), цей спринт ремайнить magic-link claim-flow під нову модель.
> **Що розблокує:** повернення CTA на лендінгу з новою архітектурою (закриває тимчасову Sprint 9 регресію); Sprint 11 (deep-link UX-recovery через `pendingPostLoginTarget`) — потребує `LandingClaimService` як stamping-point; Sprint 12 (orphan-cleanup-cron) — не блокується цим спринтом структурно, але семантично залежить (cron видаляє результати claim-flow).
> **Контекст рішень:** вступний контракт і архітектурні рішення — у [`planning-questions.md`](planning-questions.md). Цей README — імплементаційна механіка.
> **Production-data:** ще немає. Якщо до моменту імплементації Sprint 10 dev-environment-и матимуть тестові User+Business+Account документи Sprint 9 — dropDatabase + чистий старт.

---

## Мета

Повернути anon-claim flow ("Зберегти у кабінет з лендінгу") з новою архітектурою, сумісною з Business+Account-моделлю Sprint 9:

1. Замінити одиночний POST `/businesses/me` на **2 sequential POST** (Business → Account), з granular state-machine у `qrLandingDraftStore.intent` для recovery-flow на failure-point.
2. **Form-recovery patern**: failure POST1 → redirect на `/business/new?from=landing` з pre-filled через 3-step init (`reset → setType → patchFormData`); failure POST2 → redirect на `/business/{slug}/account/new?from=landing` з pre-filled IBAN; draft у localStorage не чиститься до повного success обох POST.
3. **Magic-link cross-device flow**: `POST /auth/magic-link/send` приймає optional `landingDraft` як sibling-field; зберігається у тому ж Redis-record-у `magic:${token}` з тим самим TTL. На verify backend виконує claim і повертає `claimState`-discriminator у response.
4. **Anti-spam dedup × landing-draft drift**: на dedup-hit `sendMagicLink` робить in-place overwrite трьох sibling-fields (`landingDraft`, `claimIdempotencyKey`, `termsVersion`) з `KEEPTTL` — anti-spam invariant збережено + freshness payload-у.
5. **Idempotency-key захист**: persisted UUID v4 у store через crash-cycle; backend `BusinessesService.create` дедуплікує через partial-unique-index `(ownerId, claimIdempotencyKey)`.
6. **Terms-pre-stamp**: frontend signin-page прокидає `TERMS_VERSION` у sendMagicLink-body; backend stamps `user.acceptedTermsVersion` ДО claim — закриває acceptTerms ordering window.
7. **`LandingClaimModule`** — окремий module з єдиним `LandingClaimService.attemptLandingClaim`-helper-ом. Separation of concerns від `AuthService` (testability + forward-extension friendly).

---

## Скоуп

### Backend (`apps/api`)

- 🔲 **Новий `LandingClaimModule`** (`apps/api/src/modules/landing-claim/`) — окремий module з єдиним `LandingClaimService`, що інкапсулює helper `attemptLandingClaim(ctx, draft, claimIdempotencyKey)`:
    - **Signature**: `attemptLandingClaim(ctx: { userId: string; isBookkeeperMode: boolean }, draft: LandingDraft, claimIdempotencyKey: string)`. `claimIdempotencyKey` — required (не optional), бо backend reach-ить helper тільки коли Redis-record містить landingDraft + claimIdempotencyKey як sibling-fields (cross-field-refine на SendMagicLinkSchema гарантує coexistence).
    - **`userId: string`, не `ObjectId`** — symmetric до чинного `BusinessesService.create(userId: string, dto, isBookkeeperMode)`, що сам робить `new Types.ObjectId(userId)` всередині. LandingClaimService прокидає `ctx.userId` напряму без conversion-step. `AuthService.verifyMagicLink` отримує `UserDocument` з `_id: ObjectId` → на pas-у робить `user._id.toString()` рівно одного разу.
    - **`isBookkeeperMode` обовʼязковий** — третій параметр `BusinessesService.create` визначає ownership-shape (`true` → `ownerId=null + managers=[userId]`, `false` → `ownerId=userId + managers=[]`). Caller (`AuthService.verifyMagicLink`) уже резолвить `User`-document під час verify-flow → читає `user.worksAsBookkeeper` → пасує у `ctx`.
    - **Algorithm**: 2 sequential calls — (1) `BusinessesService.create(ctx.userId, mapLandingDraftToCreateBusinessRequest(draft, claimIdempotencyKey), ctx.isBookkeeperMode)` через shared-helper з `@finly/types/contracts/landing-draft.ts` (Shared deliverable нижче); (2) `AccountsService.create(business, { iban: draft.iban })`. Тuple-result повертається у callee.
    - **Response shape** (single authoritative-точка для discriminated narrowing):
        - Success: `{ claimState: 'success', claimedBusinessSlug, claimedAccountSlug }`.
        - Business-failed: `{ claimState: 'business-failed', failedClaimDraft: draft }`.
        - Account-failed (Business створено): `{ claimState: 'account-failed', partialBusinessSlug: business.slug, failedClaimDraft: draft }`.
    - **Чому success-with-state, а не throw**: claim-failure не блокує auth (детально у `planning-questions.md`).
    - **Залежності**: `BusinessesModule` + `AccountsModule` (для injected services). **Не залежить від `AuthModule`** напряму — опаковий `ctx`-param містить уже-resolved values з verifyMagicLink-side; LandingClaimService нікого не fetch-ить.
    - **Експортує** `LandingClaimService`.
- 🔲 **`AuthModule` імпортує `LandingClaimModule`** (без `forwardRef`, бо петлі немає). `AuthService.verifyMagicLink` ін'єктує `LandingClaimService` і викликає його після успішного user-auth, якщо `payload.landingDraft + payload.claimIdempotencyKey` присутні у Redis-record-у.
- 🔲 **Order-of-operations всередині `AuthService.verifyMagicLink`**:
    1. Auth-resolve user (existing flow).
    2. Якщо `payload.termsVersion` присутній → `UsersService.stampAcceptedTerms(user._id, termsVersion)` (SP-12 terms-pre-stamp — детально нижче).
    3. Якщо `payload.landingDraft + payload.claimIdempotencyKey` присутні → `LandingClaimService.attemptLandingClaim(ctx, draft, claimIdempotencyKey)`.
    4. Видача session-credentials і response з claim-fields (claimState + claimed\*Slug + failedClaimDraft) merged у `AuthResponseSchema`-shape.
- 🔲 **`UsersService.stampAcceptedTerms(userId, version)`** — нова service-method: `User.updateOne({ _id, acceptedTermsVersion: { $ne: version } }, { $set: { acceptedTermsVersion: version, acceptedTermsAt: new Date() } })`. Idempotent — повторний call з тим самим version no-op-ить (filter `$ne` блокує перезапис того самого значення; if-version-changed — overwrite). Викликається з `AuthService.verifyMagicLink` order-step (2). **Uniform across усіх magic-link-purpose-ів** коли `payload.termsVersion` присутній — `login`, `register`, `reset-password` — без purpose-conditional gating (детально rationale у SP-12 secondary-purpose-uniform-stamp-rule).
- 🔲 **`AuthService.sendMagicLink`** — приймає **три optional sibling-fields**: `landingDraft`, `claimIdempotencyKey`, `termsVersion` (cross-field-coexistence-invariant `landingDraft <-> claimIdempotencyKey` per SendMagicLinkSchema-refine забезпечений на write-side). Зберігає всі три у тому ж Redis-record-у `magic:${token}` як sibling-sub-fields; TTL без зміни (`AUTH_MAGIC_LINK_TTL_MIN`, single source of truth для всього record-у).
- 🔲 **Dedup-hit-flow з overwrite трьох sibling-fields** (SP-8 повний алгоритм):
    1. `existingToken = await redis.get(dedupKey)`. Якщо null → fall-through на normal-flow (новий token + лист).
    2. `existingPayloadRaw = await redis.get(\`magic:\${existingToken}\`)`. Якщо null (race: magic-record експайрнувся раніше за dedup-key — теоретично можливо лише при порушенні env-invariant `AUTH_MAGIC_LINK_TTL_MIN \* 60 ≥ AUTH_MAGIC_LINK_DEDUP_SEC`що fail-fast-перевіряється у`config/env.ts`) → fall-through на normal-flow.
    3. Парсимо payload, **симетрично replace-ить кожне з трьох sibling-fields** за rule "overwrite-with-new OR drop-if-not-provided": якщо новий request містить sub-поле — значення перезаписується; якщо не містить — sub-поле видаляється з payload-у. Жодне з трьох НЕ "залипає". Cross-field-coexistence-invariant `landingDraft + claimIdempotencyKey MUST coexist` забезпечується на `SendMagicLinkSchema` write-side через cross-field-refine; до dedup-overwrite-flow доходять тільки уже-валідовані pair-и.
    4. Пишемо `redis.set(\`magic:\${existingToken}\`, JSON.stringify(updated), 'KEEPTTL')`. **`KEEPTTL`критично** — без нього`SET` reset-нув би TTL magic-record-у і відкрив би vector "n→∞ overwrites продовжують magic-link до нескінченності".
    5. Лист повторно НЕ відправляємо — anti-spam invariant збережено.
- 🔲 **`apps/api/src/config/env.ts` — cross-field invariant**: `AUTH_MAGIC_LINK_TTL_MIN * 60 ≥ AUTH_MAGIC_LINK_DEDUP_SEC`. Fail-fast on app-boot з зрозумілим повідомленням ("AUTH_MAGIC_LINK_DEDUP_SEC must not exceed AUTH_MAGIC_LINK_TTL_MIN converted to seconds"). Без цього умова SP-8 dedup-overwrite-flow ("якщо dedup-key існує, magic-record теж існує") не тримається.
- 🔲 **`BusinessesService.create(userId, dto, isBookkeeperMode)` extension** — оптіональний `dto.claimIdempotencyKey`:
    - Якщо присутній → **pre-check** `Business.findOne({ ownerId: userId, claimIdempotencyKey })`; якщо знайдено existing-документ → повертає його replay-shape (slug + повний об'єкт), НЕ створює новий.
    - Якщо не знайдено → insert з полем у документі.
    - **Race-protection через partial-unique-index**: два concurrent POST з тим самим (userId, key) — один проходить insert, другий ловить 11000 на `(ownerId, claimIdempotencyKey)` → re-fetch existing і повертає replay-shape (defense-in-depth: pre-check window race між findOne і insertOne можливий, але дуже рідкісний — partial-unique-index ловить його детермінoвано).
    - **Cabinet wizard-create** без claim-flow НЕ передає `claimIdempotencyKey`-поле; partial-filter-index його просто не торкає (поле відсутнє у документі); cabinet-create продовжує працювати без idempotency-семантики.
- 🔲 **`Business.claimIdempotencyKey` Mongoose-поле** (`apps/api/src/modules/businesses/schemas/business.schema.ts`):
    - `@Prop({ type: String, required: false }) claimIdempotencyKey?: string`.
    - **Sparse-unique-compound-index `(ownerId, claimIdempotencyKey)` через `partialFilterExpression: { claimIdempotencyKey: { $type: 'string' } }`** — partial-filter обовʼязковий, бо без нього sparse-index ловив би null-key collision на cabinet wizard-create (де поле відсутнє → MongoDB трактує як один null-bucket → 11000 на другий wizard-create без claim-flow).
- 🔲 Spec на `BusinessesService.create` (3 нові кейси): (a) без `claimIdempotencyKey` → cabinet-create працює як зараз; (b) з `claimIdempotencyKey` нової → нова Business зі stored key; (c) з `claimIdempotencyKey` existing → replay-shape без створення новиx.
- 🔲 Spec на `AuthService.sendMagicLink` dedup-overwrite (5 кейсів — SP-8 повний spec-list): (a) перший виклик з 3 полями → write-once у новий record; (b) повторний у dedup-вікні з тими самими 3 полями → no-op overwrite, лист один; (c) повторний з drift-нутим landingDraft → record оновлено, лист один; (d) повторний без landingDraft+key (reset-password-resend) → drop landingDraft+claimIdempotencyKey з Redis, `termsVersion` overwrite-нуто; (e) змішаний flow (перший без, потім з) → overwrite додає sub-fields у той самий tokenA-record.
- 🔲 Spec на `AuthService.verifyMagicLink` claim-integration (4 кейси): (a) без `landingDraft`+`claimIdempotencyKey` у Redis → no claim, baseline auth-response; (b) з обома + claim-success → response містить `claimState='success'` + claimed slugs; (c) з обома + business-failed → `claimState='business-failed'` + failedClaimDraft; (d) з обома + account-failed (Business створено) → `claimState='account-failed'` + partialBusinessSlug + failedClaimDraft.
- 🔲 Spec на `UsersService.stampAcceptedTerms` (3 кейси): idempotent на той самий version, overwrite на новий version, no-op коли version === current.
- 🔲 Spec на `LandingClaimService.attemptLandingClaim` (3 кейси): success → tuple-result з claimedBusinessSlug + claimedAccountSlug; POST1-failure → business-failed shape; POST2-failure → account-failed shape з partialBusinessSlug.

### Frontend (`apps/web`)

- 🔲 **Повернення CTA "Зберегти у кабінет" на лендінгу.** Sprint 9 вимикнув CTA через feature-flag / direct видалення button у `QrLandingResult.tsx`. Sprint 10 повертає його — на success-flow CTA тригерить standard claim-redirect (`router.push('/auth/signin')`) як Sprint 8 baseline.
- 🔲 **`features/qr-landing-preview/api.ts`** — chinний helper `claimLandingDraftAsBusiness(input): Promise<{ slug }>` **видаляється** і замінюється на дві окремі функції:
    - `createBusinessFromDraft(draft: LandingDraft, claimIdempotencyKey: string): Promise<{ slug }>` — `POST /businesses/me` з body, побудованим через **`mapLandingDraftToCreateBusinessRequest(draft, claimIdempotencyKey)`** (shared-helper з `@finly/types/contracts/landing-draft.ts`). Field-mapping (`receiverName → name`, `purpose → paymentPurposeTemplate`, `taxId` top-level, `type='individual'` фіксовано, `acceptedBanks=[...MVP_BANKS]`, `claimIdempotencyKey` top-level) — рішення helper-а; API-helper цього файлу його тільки викликає, не дублює маппінг inline. **`claimIdempotencyKey` — required-параметр**, не optional: якщо у store-snapshot-і `claimIdempotencyKey === null` коли helper викликається, TS-сторона зловить mismatch на compile-time; runtime-defense-in-depth — caller `useClaimLandingDraft` робить `assert(state.claimIdempotencyKey, 'IDEMPOTENCY_KEY_MISSING')` ДО виклику helper-а. Throws `PublicApiError` з backend `RESPONSE_CODE` на не-2xx.
    - `createAccountFromDraft(businessSlug: string, draft: LandingDraft): Promise<{ slug: string }>` — `POST /businesses/me/{businessSlug}/accounts` з body `{ iban: draft.iban }`. Account-name backend auto-generate-ить з МФО (опціональний `name` не передаємо). Throws `PublicApiError`.
    - Дві функції експортуються незалежно. Wrapper `claimLandingDraftAsBusiness` НЕ зберігається — old callsite (`QrLandingResult.tsx` для logged-in-flow з Sprint 8) ремайниться на explicit-чейн `createBusinessFromDraft → createAccountFromDraft` з тим самим try/catch + setIntent state-machine, що в `useClaimLandingDraft`.
- 🔲 **`features/qr-landing-preview/useClaimLandingDraft.ts`** ремайнінг: 1 sequential POST перетворюється на 2 sequential через нові helper-и. Перший — `createBusinessFromDraft(draft, claimIdempotencyKey)`. Другий — `createAccountFromDraft(slug, draft)`. Між ними — try/catch на кожен запит окремо; на failure — set granular intent-state і pre-fill draft у store перед navigation. **Tab-close/reload resumption** (SP-7): hook на mount **перевіряє** `intent` ДО запуску — якщо `intent ∈ {'claim-business-pending', 'claim-account-pending'}` (попередня сесія crash-нула mid-flight; `inProgressRef` не зберігся між mount-ами), НЕ повторює POST1/POST2 автоматично, а робить `setIntent('idle')` + одноразовий toast про recovery-action; user тригерить retry свідомо. Hook fires POST1 тільки коли `intent === 'claim-pending'` (Sprint 8 baseline-state, виставлений на CTA-click "Зберегти у кабінет" перед navigation, не успадкований з halfway-aborted-сесії).
- 🔲 **Form-recovery patern** на failure:
    - **Failure першого** (POST1 Business): web робить `router.push('/business/new?from=landing')`; wizard-сторінка читає `qrLandingDraftStore` і pre-fill-ить **через 3-step init**: `useBusinessWizardStore.getState().reset()` → `.setType('individual')` → `.patchFormData({ name: draft.receiverName, taxId: draft.taxId, paymentPurposeTemplate: draft.purpose })`. **Hydration-gate (mandatory для `?from=landing`-branch-у)**: `qrLandingDraftStore` персистить у localStorage через Zustand `persist`-middleware і гідратується асинхронно після першого render-у; RHF defaultValues frozen на init → 3-step init **мусить виконуватися ПІСЛЯ-hydrate**. Implementation: wizard-page (`apps/web/src/app/(protected)/business/new/page.tsx`) використовує `useHasHydrated(useQrLandingDraftStore)` shared-hook для render-gate у landing-recovery-branch. На `?from=landing` query-param активний: якщо hook повертає `false` → render skeleton; якщо `true` → run 3-step init у `useEffect`-callback з empty-deps (one-time on full-mount після hydration-complete) і потім render wizard. На стандартний flow (без `?from=landing`) — render wizard одразу без hydration-gate (store не використовується). На success під `?from=landing` — `router.push('/business/{slug}/account/new?from=landing')` замість дефолтного `/business/{slug}` empty-state. Draft у Zustand не чиститься, бо account-create-форма продовжує читати `formData.iban`; cleanup відбувається тільки на повний success обох POST.
    - **Failure другого** (POST2 Account): web робить `router.push('/business/{slug}/account/new?from=landing')`; account-create-форма (`apps/web/src/app/(protected)/business/[slug]/account/new/page.tsx`) читає `qrLandingDraftStore.formData.iban` і pre-fill-ить через RHF `defaultValues`. **Hydration-gate symmetric до wizard-page**: `useHasHydrated(useQrLandingDraftStore)` render-gate-ить landing-recovery-branch. Submit → POST account → success → `clearAll()` + redirect на `/business/{slug}/account/{accountSlug}?completed-from=landing` (banner з Sprint 8 §8.5 показується).
- 🔲 **`apps/web/src/shared/lib/useHasHydrated.ts`** — новий shared-hook, generic над Zustand persist-store-instance: `useHasHydrated<T>(store: PersistStore<T>): boolean`. Reuse `useSyncExternalStore`-pattern з existing Sprint 8 hook (`features/qr-landing-preview/lib/useHasHydrated.ts`); цей файл переноситься у shared/lib + параметризується на store-arg. Sprint 8 callsite `QrLandingBlock` оновлюється на новий signature `useHasHydrated(useQrLandingDraftStore)`. Spec-file `useHasHydrated.spec.ts` move-ається разом; додаткові кейси: (a) hydration-pending → returns false; (b) onFinishHydration fires → returns true on next render; (c) SSR-safe (`getServerSnapshot = false` детермінoвано). FSD-rationale: hook generic над зовнішнім argument-store-instance, нічого з features/entities не reference — legitimately shared.
- 🔲 **`qrLandingDraftStore` розширення**:
    - **`intent`** state-machine: `'idle' | 'claim-pending' | 'claim-business-pending' | 'claim-account-pending' | 'claimed' | 'claim-failed-business' | 'claim-failed-account'` (нові granular states між business-create і account-create). Race-protection через `inProgressRef` лишається без змін.
    - **Нове persisted поле `claimIdempotencyKey: string | null`** (default `null` у INITIAL_STATE). UUID v4 string, generated через `crypto.randomUUID()` (browser-native API). **Lifecycle (SP-11)**: generate на CTA-click "Зберегти у кабінет" коли `intent` транзитує `'idle' → 'claim-pending'` (one-time stamp per claim-attempt); reset на full-success обидвох POST через `clearAll()` (повертається у `null` разом з formData). Setter: `setIntent('claim-pending')` стає atomic-action — якщо поточний `claimIdempotencyKey === null`, генерує новий і stamp-ить разом з intent-зміною; якщо вже є непорожній — лишає той самий ключ. Інші `setIntent`-транзишени НЕ торкають `claimIdempotencyKey`.
    - **Persist-migration `1 → 2`** + новий branch у `migrate`-rule. Mapping v1 → v2: legacy `'claim-failed'` → `'idle'` (Sprint 8 user-и; нові granular `'claim-failed-business'/'claim-failed-account'` потребують контексту, який недоступний з самого факту `'claim-failed'`, тому коректний downgrade — у `'idle'`; user побачить кнопку "Спробувати знову" замість stale-failure-banner); додати `claimIdempotencyKey: null`-default для legacy-записів без поля. `formData` і `result` зберігаються (не reset, бо це user-data).
- 🔲 **Magic-link Redis-draft (frontend pass-through)**:
    - **`apps/web/src/shared/api/auth.ts:36-46`** — розширити signature `sendMagicLink(email: string, purpose?: MagicLinkPurpose, redirectTo?: string)` на **4-й optional `options`-object параметр** з shape `{ landingDraft?: LandingDraft; claimIdempotencyKey?: string; termsVersion?: string }`; прокинути у body POST-у як sibling-fields. `apiClient` уже сам serialize-ить undefined-поля — backend-DTO без полів не reject-не payload.
    - **`apps/web/src/app/auth/signin/page.tsx`** — на mount читає `useQrLandingDraftStore.getState()` (без subscribe); якщо `intent === 'claim-pending'` І `formData` містить усі 4 ключі `LandingDraftSchema` І `claimIdempotencyKey !== null`, резолвить `landingDraft = formData satisfies LandingDraft` + `claimIdempotencyKey = state.claimIdempotencyKey`. **Класифікація 4 call-site-ів `sendMagicLink`** за runtime-purpose-семантикою (правило для пари `landingDraft + claimIdempotencyKey`; `termsVersion` — окреме правило, прокидається на всіх 4 call-site-ах коли `agreedToTerms === true`):
        - **Рядок 189** (`onEmailSubmit` основного first-time signin form) — прокидає `landingDraft + claimIdempotencyKey` беззастережно. Static `purpose = isNewUser ? 'register' : 'login'`; обидва значення сумісні з anon-claim.
        - **Рядок 298** (`handleSendMagicLinkFromPassword` login fallback) — прокидає беззастережно. Static `purpose = 'login'`; user уже на signin-page з `intent='claim-pending'`.
        - **Рядок 266** (`handleForgotPassword` reset-password) — НЕ прокидає беззастережно. Static `purpose = 'reset-password'`; reset-password-flow семантично incompatible з anon-claim.
        - **Рядок 124** (`handleResend` "Надіслати повторно") — **runtime-conditional на `lastPurposeRef.current`**, НЕ статично-класифікований. Handler читає `lastPurposeRef.current`, який runtime-mutable: `handleForgotPassword` (рядок 265) виставляє ref у `'reset-password'`. Послідовність "Введи email → Перевір пошту → Забули пароль → Перевір пошту → Надіслати повторно" робить рядок 124 семантично reset-password-resend-ом. Тому handler виконує explicit guard `if (lastPurposeRef.current !== 'reset-password') landingDraft = ...; claimIdempotencyKey = ...` ДО прокидання у sendMagicLink-body.
        - **`termsVersion`** прокидається на всіх 4 call-site-ах за runtime-rule: якщо `agreedToTerms === true` на момент call-у — frontend прокидає `TERMS_VERSION` constant з `@finly/types/constants/terms.ts`. Reset-password-resend (рядок 124 з runtime-mutable purpose) теж прокидає, бо user уже погодився на terms на email-form-step.
    - **Hydration-gate у submit-handler, НЕ у render** — signin-сторінка є головною точкою входу для **всіх** користувачів. Render не блокується (форма видима миттєво); hydration-перевірка живе всередині submit-handler-а через `useQrLandingDraftStore.persist.hasHydrated()` + `onFinishHydration(cb)` await-flow.
    - Spec-кейси signin-page: 6 кейсів (положителні і regression на runtime-conditional guard).
- 🔲 **Web-side claim-on-magic-link verify-page handler** (`apps/web/src/app/auth/verify/page.tsx`) — integration claimState-логіки з existing 4-гілковим `switch (result.purpose)`. Чинна структура: `verifyMagicLink(token)` → switch на `purpose ∈ {register, login, delete-account, default}` → для перших трьох виконує `acceptTerms() + getMe() + setUser(user)` → `router.replace(redirectTarget)`; для `delete-account` — terminal-state `'deleted'`. Sprint 10 додає **claim-handling як post-auth-finalization-step ПЕРЕД фінальним `router.replace`**, не замінюючи сам switch:
    1. `verifyMagicLink(token)` → response містить опціональні `claimState, claimedBusinessSlug?, claimedAccountSlug?, partialBusinessSlug?, failedClaimDraft?` — присутні **iff backend виконував claim**.
    2. Branch на `result.purpose`. Для `delete-account` — terminal `'deleted'` без жодних claim-actions. **Combination `purpose='delete-account' + landingDraft` структурно неможлива** (public endpoint `/auth/magic-link/send` reject-ає `delete-account` purpose; cabinet endpoint `/users/account/delete` не має `landingDraft`-поля у DTO).
    3. Для `register / login / default` — виконати `acceptTerms() + getMe() + setUser(user)` синхронно. **Auth-finalization безумовний**: user-store-hydration потрібний для AuthGuard на target-page; `acceptTerms()` стає idempotent-no-op для claim-flow (terms уже stamp-нутий backend-side per SP-12).
    4. **Розгалуження по `result.claimState`** (post-auth-finalization, pre-redirect):
        - `claimState === undefined` (не-claim magic-link) → `router.replace(redirectTarget)`. Рівно поточна поведінка для register/login/default — backwards-compat invariant.
        - `claimState === 'success'` → `useQrLandingDraftStore.getState().clearAll()` → `router.replace('/business/{claimedBusinessSlug}/account/{claimedAccountSlug}?completed-from=landing')`. **`?redirect=` ігнорується** — claim-flow і не-claim-flow mutually exclusive.
        - `claimState === 'business-failed'` → `useQrLandingDraftStore.getState().setFormData(failedClaimDraft); useQrLandingDraftStore.getState().setIntent('claim-failed-business')`; `router.replace('/business/new?from=landing')`. **clearAll НЕ викликається** — formData мусить дожити до повного recovery.
        - `claimState === 'account-failed'` → `setFormData(failedClaimDraft); setIntent('claim-failed-account')`; `router.replace('/business/{partialBusinessSlug}/account/new?from=landing')`.
    5. **Profile-completeness — НЕ verify-page-concern**: AuthGuard на target-page ловить incomplete-profile і будує `next` з поточного pathname+searchParams (див. AuthGuard-bullet нижче). Це включає і claim-target, і failure-target.
       Spec на verify-page: 6 кейсів — (1) purpose=register без claim → fall-through redirectTarget; (2) purpose=register з claimState=success → clearAll + claim-target; (3) purpose=login з claimState=success → clearAll + claim-target; (4) purpose=login з claimState=business-failed → setFormData+setIntent+'/business/new?from=landing'; (5) purpose=login з claimState=account-failed → setFormData+setIntent+'/business/{partial}/account/new?from=landing'; (6) purpose=delete-account → terminal 'deleted' (claim-state не обробляється).
- 🔲 **`apps/web/src/app/(protected)/profile/page.tsx`** — приймає optional `?next=` query-param (validated як same-origin path: must start with `/`, не `//`, не `http://`/`https://`); після успішного PATCH `/users/me` коли `mode=new` — `router.push(decodedNext)` замість дефолтного cabinet root. Невалідний `next` → silent fallback на дефолт (open-redirect-захист).
- 🔲 **`AuthGuard` (cabinet) — автоматична побудова `next` з поточного URL при onboarding-incomplete-редіректі.** Чинний `apps/web/src/features/auth/AuthGuard.tsx` робить `router.replace('/profile?mode=new')` без `next`. Sprint 10 розширює: коли AuthGuard ловить `isAuthenticated && !onboardingDone && !isProfilePage`, він конструює `next = pathname + (searchParams.toString() ? '?' + searchParams.toString() : '')` (через `useSearchParams()`) і робить `router.replace('/profile?mode=new&next=' + encodeURIComponent(next))`. Якщо `pathname` уже починається з `/profile` — без `next` (fallback на дефолт). Це покриває обидва сценарії одним механізмом:
    - **Post-claim flow**: verify-page робить `router.replace('/business/{biz}/account/{acc}?completed-from=landing')`. Target-page mount-ить layout → AuthGuard бачить incomplete-profile → будує `next` з цього path → `/profile?mode=new&next=...` → онбординг → return на оригінальний target.
    - **Direct deep-link у incomplete-profile-state**: користувач набирає `/business/foo` напряму. AuthGuard будує `next=/business/foo` → онбординг → return на той самий path. UX-бонус.
      Open-redirect-ризик відсутній: `pathname` приходить з `usePathname()`, що повертає виключно in-app-relative-path. Тести: spec на `AuthGuard.tsx` із 3 кейсами (post-claim target, direct deep-link, profile-self-redirect).
- 🔲 Tests: e2e claim-flow (success + business-failure + account-failure-recovery + magic-link-cross-device-flow). spec для `LandingDraftSchema` round-trip serialization.

### Shared (`@finly/types`)

- 🔲 **Новий `packages/types/src/contracts/landing-draft.ts`**:
    - `LandingDraftSchema` — спільний контракт для anon-claim payload (frontend store + backend `SendMagicLinkDto.landingDraft` + Redis-record-у + verify-response `failedClaimDraft`). Поля: `{ receiverName, iban, taxId, purpose }` — точно ті самі ключі, що вже у `QrPreviewInputSchema`. Імплементаційно `LandingDraftSchema = QrPreviewInputSchema.pick({ receiverName, iban, taxId, purpose })` або re-export. Жодної міграції localStorage-payload-у не потрібно.
    - **Pure-function helper `mapLandingDraftToCreateBusinessRequest(draft: LandingDraft, claimIdempotencyKey: string): CreateIndividualBusinessRequest`** як **single source of truth** для семантичного field-mapping-у: `receiverName → name`, `purpose → paymentPurposeTemplate`, type фіксований `'individual'`, `acceptedBanks: [...MVP_BANKS]`, top-level `taxId`, `claimIdempotencyKey` top-level. **Чому `claimIdempotencyKey` — окремий argument, а НЕ 5-те поле `LandingDraftSchema`**: семантично draft = "що ввели на лендінгу" (4 user-input-поля), idempotency-key = технічний deduplication-token; тримати їх окремо тримає LandingDraft-shape user-facing і малим. Реалізація-callsite — рівно дві: (a) frontend `createBusinessFromDraft` API-helper; (b) backend `LandingClaimService.attemptLandingClaim`. Без spільного helper-а Sprint 10 одночасно вводить дві незалежні реалізації того самого mapping-у — frontend і backend — і drift-vector активується першим розширенням `LandingDraft`. TS compile-time guard через явний return-type `CreateIndividualBusinessRequest`.
    - Spec-кейси: (1) round-trip `mapLandingDraftToCreateBusinessRequest(draft, 'uuid-string') → CreateIndividualBusinessSchema.parse(...)` зелений для всіх 5 полів результату; (2) `acceptedBanks.length === MVP_BANKS.length`; (3) negative — UUID не-v4-формату reject-нутий через `z.string().uuid()` на write-DTO рівні.
- 🔲 **`packages/types/src/contracts/auth.ts` рефакторинг** — дві синхронні зміни:
    - **`SendMagicLinkSchema`** — додати три optional sibling-fields: `landingDraft: LandingDraftSchema.optional()` + `claimIdempotencyKey: z.string().uuid().optional()` + `termsVersion: z.string().optional()`. Cross-field-refine: (i) якщо `landingDraft` присутній → `claimIdempotencyKey` обовʼязково присутній; (ii) симетрично — `claimIdempotencyKey` без `landingDraft` невалідно; refine-message `LANDING_DRAFT_AND_KEY_MUST_COEXIST`. `termsVersion` — окремий optional-field без cross-field-coupling.
    - **`AuthResponseSchema`** — додати 5 optional claim-fields: `claimState?: 'success' | 'business-failed' | 'account-failed'`, `claimedBusinessSlug?: string`, `claimedAccountSlug?: string`, `partialBusinessSlug?: string`, `failedClaimDraft?: LandingDraftSchema.optional()`. Discriminated narrowing-rule (refine на `claimState`-discriminator): `'success'` ⇒ присутні `claimedBusinessSlug + claimedAccountSlug`; `'business-failed'` ⇒ присутній `failedClaimDraft`; `'account-failed'` ⇒ присутні `partialBusinessSlug + failedClaimDraft`. Не-claim magic-link-и — всі 5 полів `undefined` (backwards-compatible зі Sprint 8 callsite-ом `verifyMagicLink`).
    - Spec `auth.spec.ts` round-trip: 5 кейсів — позитивні всі 3 claim-states + negative refine-violation + backwards-compat (всі 5 claim-полів undefined).
- 🔲 **`packages/types/src/entities/business.ts` рефакторинг** — додати optional `claimIdempotencyKey?: string` (UUID v4 string) — sparse-stored поле, що пишеться лише на anon-claim-flow create-path-у.
- 🔲 **`packages/types/src/contracts/businesses.ts` рефакторинг** — додати optional `claimIdempotencyKey?: z.string().uuid()` у base-fields усіх 4 variants `CreateBusinessSchema`. `UpdateBusinessSchema` — без `claimIdempotencyKey` (immutable після create). `PublicBusinessSchema` — НЕ містить (server-internal-detail).

### Cross-cutting docs

- 🔲 `CLAUDE.md`:
    - Module Dependency Map — додати `LandingClaimModule` (новий, залежить від BusinessesModule + AccountsModule + (Sprint 11) UsersModule, імпортується AuthModule-ом для **separation of concerns**; не cycle-breaking).
    - Known Complexities — нові пункти: "Sprint 8 claim — 2 sequential з form-recovery + Redis-draft sub-поле + LandingClaimModule як separation-of-concerns", "Magic-link dedup × landingDraft overwrite з KEEPTTL + cross-field invariant `AUTH_MAGIC_LINK_TTL_MIN * 60 ≥ AUTH_MAGIC_LINK_DEDUP_SEC`", "Business.claimIdempotencyKey sparse-unique для anon-claim dedup", "Terms-pre-stamp у magic-link verify закриває acceptTerms ordering window".
- 🔲 `docs/manual-checks/README.md` — нові UAT-пункти:
    - **CLAIM-1 — Anon-claim same-device через Google OAuth (existing user, повний профіль).** На десктопі ввести IBAN+ІПН+name+purpose на лендінгу, натиснути "Зберегти у кабінет" → вибрати Google OAuth → потрапити прямо на `/business/{slug}/account/{accountSlug}` з готовим QR і banner-ом "Бізнес і рахунок збережено з лендінгу". Перевірка функціональності banner-а: клік на CTA banner-а → cross-page-перехід на `/business/{slug}` зі scroll-to-anchor `#banks`.
    - **CLAIM-2 — Anon-claim cross-device через magic link (existing user, повний профіль).** На десктопі ввести дані → "Зберегти у кабінет" → magic link → ввести email **уже зареєстрованого користувача**. Відкрити email на телефоні (різний браузер) → клікнути magic link → потрапити прямо на `/business/{slug}/account/{accountSlug}` з готовим QR і banner-ом.
    - **CLAIM-3 — Anon-claim cross-device з profile-completion-stop.** Той самий flow, але email **нового користувача без firstName/lastName**. Phone після клік magic link: backend виконав claim, verify-page робить router.replace, AuthGuard бачить incomplete-profile → /profile?mode=new&next=... → ФОП заповнює → автоматичний redirect назад на per-account-page з banner-ом.
    - **CLAIM-4 — Anon-claim recovery після failed Account.** Симулювати failure POST account → web редіректить на `/business/{slug}/account/new?from=landing` з pre-filled IBAN; submit → success → per-account-page з banner-ом.
    - **CLAIM-5 — Anon-claim recovery після failed Business.** Симулювати failure POST business → web редіректить на `/business/new?from=landing` з pre-filled wizard-полями (name, taxId, paymentPurposeTemplate); submit wizard → автоматичний redirect на `/business/{slug}/account/new?from=landing`; submit account → per-account-page з banner-ом.
    - **CLAIM-6 — Idempotency-key захист від duplicate-Business.** Симулювати tab-close після успішного POST1, але до response receive. У наступну сесію (новий browser-tab) натиснути на ту саму CTA "Зберегти у кабінет" з тими самими даними. Backend через partial-unique-index повертає existing Business replay-shape; web завершує POST2 з тим самим business-slug-ом. Перевірка staging-БД: `Business.countDocuments({ ownerId: user._id })` рівно 1, не 2.
    - **CLAIM-7 — Magic-link dedup-overwrite.** Анон вводить дані A → magic-link sent. Не клікаючи на лист, виправляє typo (дані B) і знову тиснe "Зберегти у кабінет" у dedup-вікні. Лист другий НЕ приходить (anti-spam invariant). Клікнути original-лист → backend resolve-ить останній snapshot (дані B), claim створює Business+Account з даними B. Перевірка: staging-БД відображає payload B, не A.

---

## НЕ-скоуп

- ❌ **Cross-cutting refactor terms на backend для всіх auth-flow-ів** (Google OAuth, password-login, password-reset через окремий non-magic-link path). Sprint 10 закриває magic-link-claim-flow window локально; Sprint 13+ tech-improvement-ticket "backend acceptTerms cross-cutting refactor".
- ❌ **Server-side reconciliation для anon-claim crash-resumption** (наприклад, GET /businesses/me → match по taxId/name → продовжити з POST2 якщо знайдено). Sprint 10 MVP-рішення — reset intent на `'idle'` + user-driven retry; reconciliation потребує telemetry-evidence. Sprint 13+ ticket.
- ❌ **AuthInitializer розширення для cold-login deep-link resume** — Sprint 11 deliverable (потребує `User.pendingPostLoginTarget`-field).
- ❌ **Multi-attempt claim з queue** ("якщо було кілька failed-claim-attempt-ів — спробуй кожен"). Single-attempt + user-driven retry — простіший і достатній.
- ❌ **Notification-bell для in-app "Ваш бізнес-claim не завершився"-reminder** — не існує notification-infrastructure у MVP; Phase 1.5+.

---

## Епіки

### 10.0 Shared types — LandingDraft contract + AuthResponse claim-extension + Business idempotency-key

- 🔲 `packages/types/src/contracts/landing-draft.ts` — `LandingDraftSchema` + `mapLandingDraftToCreateBusinessRequest`-helper.
- 🔲 `packages/types/src/contracts/auth.ts` — `SendMagicLinkSchema` + `AuthResponseSchema` розширення з claim-fields і cross-field refine.
- 🔲 `packages/types/src/entities/business.ts` + `packages/types/src/contracts/businesses.ts` — `claimIdempotencyKey` optional поля.
- 🔲 Specs: `landing-draft.spec.ts` (round-trip + mapping + UUID validation); `auth.spec.ts` (claim-fields round-trip + cross-field refine); `business.spec.ts` (idempotency-key optional).
- 🔲 **Acceptance:** `pnpm --filter @finly/types build` зелений; `pnpm --filter @finly/types test` зелений.

### 10.1 Backend — LandingClaimModule + AuthService extension + dedup-overwrite + idempotency + terms-pre-stamp

- 🔲 `LandingClaimModule` зі `LandingClaimService.attemptLandingClaim`.
- 🔲 `AuthService.sendMagicLink` extension — приймає 3 optional sibling-fields; dedup-hit-overwrite з KEEPTTL.
- 🔲 `AuthService.verifyMagicLink` extension — order-of-operations (terms-stamp → claim → session); merge claim-state у response.
- 🔲 `UsersService.stampAcceptedTerms` нова method.
- 🔲 `BusinessesService.create` extension — приймає optional `claimIdempotencyKey`; pre-check + race-protection через partial-unique-index.
- 🔲 `Business.claimIdempotencyKey` Mongoose-поле + sparse-unique-compound-index `(ownerId, claimIdempotencyKey)`.
- 🔲 `apps/api/src/config/env.ts` cross-field invariant `AUTH_MAGIC_LINK_TTL_MIN * 60 ≥ AUTH_MAGIC_LINK_DEDUP_SEC`.
- 🔲 Specs: 3 нові кейси `BusinessesService.create` + 5 кейсів `sendMagicLink` dedup-overwrite + 4 кейси `verifyMagicLink` claim-integration + 3 кейси `stampAcceptedTerms` + 3 кейси `LandingClaimService.attemptLandingClaim`.

### 10.2 Frontend — qrLandingDraftStore extensions + useClaimLandingDraft 2-step + form-recovery + signin-page + verify-page + AuthGuard

- 🔲 `qrLandingDraftStore` — intent state-machine + `claimIdempotencyKey` field + persist v1→v2 migration.
- 🔲 `features/qr-landing-preview/api.ts` — `createBusinessFromDraft` + `createAccountFromDraft` replace old wrapper.
- 🔲 `useClaimLandingDraft` — 2 sequential POST з granular intent + tab-close resumption logic.
- 🔲 `apps/web/src/shared/lib/useHasHydrated.ts` — generic shared-hook (move з features).
- 🔲 `apps/web/src/app/(protected)/business/new/page.tsx` + `apps/web/src/app/(protected)/business/[slug]/account/new/page.tsx` — `?from=landing` pre-fill з 3-step init + hydration-gate.
- 🔲 `apps/web/src/app/auth/signin/page.tsx` — sendMagicLink 4-call-site mapping з runtime-conditional guard на рядок 124.
- 🔲 `apps/web/src/app/auth/verify/page.tsx` — claimState handler 4 branches.
- 🔲 `apps/web/src/features/auth/AuthGuard.tsx` — автоматична побудова `next` з поточного URL.
- 🔲 `apps/web/src/app/(protected)/profile/page.tsx` — `?next=` query-param consumption з open-redirect validation.
- 🔲 CTA "Зберегти у кабінет" повернути на лендінгу (revert Sprint 9 hide-deliverable).
- 🔲 Specs: signin-page 6 кейсів + verify-page 6 кейсів + AuthGuard 3 кейси + useClaimLandingDraft regression + useHasHydrated 3 кейси.

### 10.3 Cross-cutting docs

- 🔲 `CLAUDE.md` оновлений (Module Dependency Map + Known Complexities).
- 🔲 `docs/manual-checks/README.md` нові UAT-пункти CLAIM-1..7.

---

## Risks / Known Complexities

- **Ризик 1 — Sprint 9 deploy лишається без CTA "Зберегти у кабінет" до Sprint 10 deploy.** Якщо production traffic зʼявиться у window між Sprint 9 і Sprint 10 — user-facing-регресія: лендінг показує QR-preview, але без CTA для signup. Mitigation: production-traffic відсутній на момент планування (вступний контракт Sprint 9). Якщо буде запуск маркетинг-кампанії — Sprint 10 пріоритизується.
- **Ризик 2 — Magic-link cross-device flow складний для тестування.** Симуляція "відкрити email на іншому пристрої" локально неможлива без реальних телефонів. Mitigation: e2e тест через два browser-context-и (Playwright), що імітують різні local-storage isolation. Manual UAT CLAIM-2, CLAIM-3 — обовʼязковий перед release.
- **Ризик 3 — `useClaimLandingDraft` tab-close mid-flight resumption-flow** (closed-by-design через SP-11 idempotency-key). Duplicate-Business-on-retry — backend через partial-unique-index `(ownerId, claimIdempotencyKey)` повертає existing Business slug замість створення нового. POST2-step безпечний завдяки `(businessId, iban)` compound-unique на Account (Sprint 9 §SP-2). False-positive duplicate Business фізично неможливий через DB-рівень-invariant; false-negative (user втратив контекст, дані у store) лишається benign — recovery через wizard зі store.formData.
- **Ризик 4 — `acceptTerms` ordering window** (closed-by-design через SP-12 terms-pre-stamp). Backend `AuthService.verifyMagicLink` stamps `user.acceptedTermsVersion` на verify-flow-step (2) — ДО (3) `LandingClaimService.attemptLandingClaim`. Order-of-operations гарантує: claim не виконується, поки terms не stamped; на verify-throw — claim не запускається. Frontend `acceptTerms()` лишається без змін — для claim-flow стає idempotent-no-op.
- **Ризик 5 — `landingDraft` payload-leak у Redis для reset-password-resend без frontend-guard-у.** `handleResend` (signin/page.tsx:124) використовує `lastPurposeRef.current`, який runtime-mutable. Mitigation: explicit guard у `handleResend` + spec-кейси (5)/(6) на runtime-conditional regression. Backend cross-field DTO-guard свідомо НЕ додається — frontend-rule достатній.
- **Ризик 6 — Backward-compat existing magic-link records на момент deploy.** Якщо у Redis live стара magic-record-у без полів landingDraft/claimIdempotencyKey/termsVersion — на verify backend `payload.landingDraft === undefined` → claim не fires (no-op), authflow продовжується як Sprint 8 baseline. Mitigation: всі sub-fields optional на read; existing records гасинуть на natural TTL без потреби migration.

---

## Definition of Done

- ✅ Усі епіки 10.0..10.3 закриті.
- ✅ `pnpm test` зелений по всіх workspace-ах.
- ✅ `pnpm lint` без нових warnings.
- ✅ `pnpm build` всіх workspace-ів success.
- ✅ Smoke-test на staging:
    - Anon-claim same-device через Google OAuth → /business/{biz}/account/{acc} з banner-ом.
    - Anon-claim cross-device через magic-link (existing user) → /business/{biz}/account/{acc} з banner-ом.
    - Anon-claim cross-device з profile-completion-stop → /profile?next=... → after-onboarding redirect → per-account з banner-ом.
    - Recovery після failed Business → wizard з pre-fill → success → continue до account-create → per-account з banner-ом.
    - Recovery після failed Account → account-create з pre-fill IBAN → success → per-account з banner-ом.
- ✅ UAT manual-checks CLAIM-1..7 — статус ⬜ → ✅ або документований negative-result з ticket-ом.
- ✅ CTA "Зберегти у кабінет" видима і функціональна на лендінгу (revert Sprint 9 hide-deliverable).
- ✅ `CLAUDE.md` оновлений (Module Dependency Map + Known Complexities).
- ✅ Sprint 9 §Risks #11, #12, #13 — позначені як closed-by-design з посиланням на Sprint 10 SP-7, SP-12, SP-11 у Sprint 10 README.
