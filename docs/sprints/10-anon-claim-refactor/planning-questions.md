# Sprint 10 — Планування. Q&A

> Спринт виокремлений з оригінального Sprint 9 рішенням 2026-05-11. Контекст і всі продуктові рішення зафіксовані у Q&A файлі Sprint 9: [`../09-accounts/planning-questions.md`](../09-accounts/planning-questions.md). Цей файл фіксує те, що специфічне саме для Sprint 10 (anon-claim refactor на нову Business+Account модель) і не покривається загальним Sprint 9 контекстом.

## Чому окремий спринт

Sprint 9 закриває core-рефакторинг Business → Business + Account. Schema-change ламає Sprint 8 anon-claim flow на backend-рівні: чинний `POST /businesses/me` приймав body з `requisites.iban`, після Sprint 9 — flatten `taxId` top-level + `iban` зник з Business повністю (переїхав на Account через separate endpoint). Без рефакторингу claim-flow CTA "Зберегти у кабінет" на лендінгу повертала б 400 від backend після Sprint 9 deploy.

Sprint 9 свідомо тимчасово вимикає CTA на лендінгу (CTA-button hide через feature flag). Sprint 10 — повертає його з новою архітектурою: 2 sequential POST (Business → Account), magic-link через Redis-draft sub-поле для cross-device flow, claim-state-machine з form-recovery, idempotency-key захист від duplicate-Business на retry-after-tab-close, terms-pre-stamp на backend для закриття acceptTerms ordering window.

Це окрема концерн — claim-flow modernization, не domain-refactoring і не retention. Має власну архітектуру (state-machine, Redis-record-pattern, idempotency-pattern), власний UAT (cross-device test, network-drop test, retry-after-tab-close test).

Sprint 9 + Sprint 10 deploy-послідовно близько — інакше CTA на лендінгу залишається вимкненою. Якщо production traffic відсутній (вступний контракт plan-у), регресія невидима.

## Закриті продуктові рішення

Усі рішення для цього спринту зафіксовані як SP-7, SP-8, SP-11, SP-12 у оригінальному Sprint 9 README (видалені звідти 2026-05-11 при розщепленні). Ключові пункти:

### Чому 2 sequential POST (а не атомарний один)

- Стан "Business без Account" валідний за Q3-A2 рішенням Sprint 9 (порожня юр-сутність валідна).
- Failure-recovery природніший через "доробити пів-готову систему": при failure POST2 user-friendly редіректить на account-create-форму з pre-filled IBAN; user робить 1 click submit і claim завершено.
- Атомарний endpoint потребував би два домен-сервіси (Business + Account) у одному backend-controller-і з повним rollback-pattern, що смисл-роздробляє domain-boundaries.

### Чому Redis-draft, а не JWT-encoded payload у magic-link URL

- Privacy-leak: magic-link URL з'являється у email-логах, browser-history, referer-headers. JWT base64-decode-ується без ключа — IBAN/ІПН/назву видно будь-кому, хто отримав доступ до URL.
- Redis-draft зберігається server-side з тим самим TTL як magic-link-token; magic-link URL у листі — без даних, тільки token-id.

### Чому overwrite-усі-три sibling-fields на dedup-hit

`AuthService.sendMagicLink` має anti-spam dedup через ключ `magic_dedup:${email}:${purpose}` з TTL 60s. Якщо user натискає "Зберегти у кабінет" двічі у dedup-вікні з різними даними (typo-correction) — stored payload не повинен залипати з попереднього request-у. На dedup-hit `sendMagicLink` робить in-place overwrite трьох sibling-fields (`landingDraft`, `claimIdempotencyKey`, `termsVersion`) за rule "overwrite-with-new OR drop-if-not-provided", з `KEEPTTL` опцією щоб anti-spam window не продовжувався. Лист повторно НЕ відправляється.

Альтернативу "invalidate dedup на drift" відхилено: ламає anti-spam, drift draft на 1 байт обходить 60s-вікно і відкриває spam-vector.

### Чому idempotency-key per landing-draft (а не per-claim-attempt)

Tab-close mid-flight: POST1 commit-нувся на сервері, юзер закрив таб ДО response. Persisted `intent='claim-business-pending'` у store, але client не знає чи Business реально створено. Retry без idempotency створив би дублікат.

Idempotency-key генерується frontend-side на CTA-click "Зберегти у кабінет" одноразово (`crypto.randomUUID()`) і живе через crash-cycle у persisted store. Backend `BusinessesService.create` має partial-unique-index `(ownerId, claimIdempotencyKey)` — повторний POST з тим самим key повертає existing Business slug без створення нового.

Account-step idempotency не потребується — `(businessId, iban)` compound-unique з Sprint 9 §SP-2 уже дає той самий ефект.

### Чому terms-pre-stamp на backend ПЕРЕД claim, а не cross-cutting refactor

Race-window: backend виконав claim → response повертається на frontend → frontend `acceptTerms()` throws (network glitch) → state без terms-stamp. Cross-cutting refactor terms для всіх auth-flow-ів (Google OAuth, password-login, password-reset) — Sprint 13+ scope, потребує переписування 4+ flow-ів.

Sprint 10 фікс локальний: backend `verifyMagicLink` stamps `user.acceptedTermsVersion` ДО `LandingClaimService.attemptLandingClaim`. Frontend `acceptTerms()` стає idempotent-no-op (server-filter `$ne` блокує повторний write). Race-window закрито для magic-link-claim-flow без перетягування scope на інші flow-и.

### Чому LandingClaimModule (а не вкладено у AuthService)

- AuthService scope-discipline: claim-логіка (2 sequential domain POSTs з failure-resolution) — інша concern, що засмічує AuthService responsibilities-set.
- Testability: LandingClaimService мокається у AuthService.verifyMagicLink-spec одним provider-override-ом замість мокування двох downstream-services з повним set-ом їхніх dependencies.
- Forward-extension friendly: додавання третього claim-step-у у Sprint 13+ live-ить у LandingClaimService без розширення AuthService-граф.

Не cycle-breaking — Auth ↔ Users existing forwardRef-розв'язок зберігається без змін.

### Чому verify-page response повертає `claimState`-discriminator (а не throws на claim-failure)

Claim-failure НЕ блокує auth — user уже автентикований, accessToken у response body, refresh-cookie виставлено. Throw з `CLAIM_*_FAILED` змусив би verify-page обробляти exception-flow поряд із success-flow і втратити session-credentials у catch-гілці (axios-interceptor не зробив би `setUser(user)` на throw-path).

Discriminated success-shape з `claimState ∈ {'success', 'business-failed', 'account-failed'}` — uniform path, де finalization (acceptTerms + getMe + setUser) працює однаково, а claim-state перевіряється post-finalization для router.replace-target-у.

## Не вирішено / open follow-up

Жодних відкритих питань на момент створення спринту. Якщо при імплементації виявляться нові — додавати сюди.
