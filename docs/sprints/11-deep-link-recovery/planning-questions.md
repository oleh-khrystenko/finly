# Sprint 11 — Планування. Q&A

> Спринт виокремлений з оригінального Sprint 9 рішенням 2026-05-11. Контекст і всі продуктові рішення зафіксовані у Q&A файлі Sprint 9: [`../09-accounts/planning-questions.md`](../09-accounts/planning-questions.md). Цей файл фіксує те, що специфічне саме для Sprint 11 (deep-link UX-recovery) і не покривається загальним Sprint 9 контекстом.

## Чому окремий спринт

Sprint 10 повертає anon-claim flow з новою архітектурою (2 sequential POST через `LandingClaimService`), і на success-path-у resolve-ить пару `(claimedBusinessSlug, claimedAccountSlug)`. Same-device-flow (юзер чекає на verify-response у тому ж табі) одразу робить `router.replace('/business/{biz}/account/{acc}?completed-from=landing')` — без потреби у persisted target.

Проблема — cold-login-recovery: phone-юзер відкрив магічне посилання, backend створив Business+Account+session-credentials, але юзер закрив таб ДО `router.replace` через якусь причину (отвернувся, бракує мобільного інтернету, accident). У наступну сесію (день/тиждень пізніше) юзер свідомо логіниться → дефолтний flow веде на `/business` cabinet-root → юзер бачить уже створений Business у списку, але banner `?completed-from=landing` не показується (він зав'язаний на per-account-page з query-param-ом), і інструкція "Перевірте список банків" втрачена.

Sprint 11 закриває це через `User.pendingPostLoginTarget`-stamp на success-claim і resume через AuthInitializer на наступному cold-login.

Це окрема концерн — UX-recovery, не claim-flow і не retention. Має малий обсяг (1 поле + 2 точки інтеграції), власну архітектуру (frontend-resume через AuthInitializer-effect), і відсутність блокування на Sprint 12 cron — pendingPostLoginTarget живе незалежно від retention-pipeline.

## Закриті продуктові рішення

Усі рішення для цього спринту зафіксовані як SP-13 part 1 у оригінальному Sprint 9 README (видалені звідти 2026-05-11 при розщепленні). Ключові пункти:

### Чому stamp ВСЕРЕДИНІ LandingClaimService, не у verifyMagicLink

`LandingClaimService.attemptLandingClaim` єдиний на сервері знає, що claim успішно завершився і має канонічну пару `(claimedBusinessSlug, claimedAccountSlug)`. Stamp поряд з successful return-у тримає responsibility-bundle: "stamp-target живе разом з claim-success-flow". Якщо в майбутньому з'явиться альтернативний claim-entry-point (наприклад, через OAuth, не magic-link), stamp залишиться синхронним з claim-flow і не потребує дублювання.

### Чому unconditional stamp (а не "stamp тільки коли user incomplete-profile")

Backend на момент claim не знає, чи юзер закриє таб до verify-response (same-device) чи отримає response (typical happy path). Тому stamp unconditional — write-once на success-claim. Consume-and-clear ділиться між двома frontend-call-site-ами:

- Same-device flow: verify-page-handler clear-ить immediately ДО redirect-у. AuthInitializer на target-page вже бачить null.
- Cold-login flow: AuthInitializer ловить stamped target і робить clear-then-redirect.

Якщо stamp був conditional на profile-state, backend би мусив робити extra read user-doc-у поза claim-flow-context-ом — зайвий код-path без UX-користі.

### Чому AuthInitializer, а не AuthGuard

`AuthGuard` живе у protected-layout і fires на route-mount; на cold-login flow юзер з cabinet-root падає у `AuthGuard.tsx` → onboarding-check → `router.replace(...)`. Якщо AuthGuard читав би `pendingPostLoginTarget`, він би мусив це робити поверх existing onboarding-logic, що змішує дві відповідальності.

`AuthInitializer` живе вище у дереві (root layout) і fires на bootstrap після `getMe()`-resolve. Це природна точка для one-time-redirect-actions: clear-then-replace перед тим, як юзер побачить будь-яку protected-сторінку.

### Чому `triedRef`-block AuthInitializer-у не ламає cold-login flow

`AuthInitializer` має `triedRef.current = true` early-return guard, що spike-ається при першому mount у session-cycle. На cold-login (новий browser-session) `triedRef` стартує fresh як false → effect fires → читає stamped target → clear+replace. На subsequent mount у тій же session (наприклад, route-change у protected-зоні) effect не fires повторно — це OK, бо stamp уже cleared.

Same-device flow обходить AuthInitializer-recovery через explicit clear у verify-page-handler ДО redirect-у. Verify-page mount-ить AuthInitializer один раз (на `/auth/verify`-mount, де SELF_AUTH_PATHS-branch робить `clearUser() + return`), `triedRef.current = true` set-иться, але pendingPostLoginTarget на цьому етапі вже cleared verify-handler-ом сам — AuthInitializer не бачить stamp і no-op-ить.

### Чому open-redirect-protection двошарова (backend + frontend)

Backend `UsersService.setPendingPostLoginTarget` валідує `target.startsWith('/')` AND `!target.startsWith('//')` AND `!/^https?:\/\//.test(target)` ДО write-у — invalid path → throw, claim-flow тримається без stamp-у (acceptable degradation).

Frontend `AuthInitializer` перевіряє те саме на read-у ДО `router.replace` — defense-in-depth. Invalid path (наприклад, через direct БД-edit на staging) → log warn + clear field + skip redirect.

Single source of truth для path-safety-rule — shared-helper `validateSameOriginPath(target)` у `packages/types/src/utils/path.ts`. Reuse-ається на 3 call-site-ах: Zod-refine у user-entity, backend write-helper, frontend read-helper.

## Не вирішено / open follow-up

Жодних відкритих питань на момент створення спринту. Якщо при імплементації виявляться нові — додавати сюди.
