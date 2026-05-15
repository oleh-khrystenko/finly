# Sprint 13 — Планування. Q&A

> Спринт розв'язує реальну модульну петлю Auth → LandingClaim → Users → Auth (а також Auth → Storage → Users → Auth) шляхом інверсії залежності, а не прикриттям через `forwardRef`. Контекст і трейс CJS-evaluation проблеми з'ясовано емпірично у попередній debug-сесії: `docker compose -f docker-compose.dev.yml` падає з `UndefinedModuleException` на `StorageModule` і `LandingClaimModule` починаючи з Sprint 8 (avatar додав Storage в петлю). Існуючий `forwardRef(() => AuthModule)` у `UsersModule` розриває петлю на рівні Nest scanner, але CJS-emit декораторів читає `UsersModule` як `undefined` у момент `@Module`-декорації Storage і LandingClaim. Користувач свідомо обирає чистий розрив залежності замість косметичних `forwardRef` у кожній проблемній точці.

## Архітектурний контекст

Інфраструктурні модулі (Auth — токени, сесії, magic-link; Storage — файли в R2) не повинні знати про бізнес-фічі (LandingClaim — конверсія анонімного гостя у власника бізнесу) і про доменні сутності верхнього рівня (Users — профіль). Зараз порушено:

- AuthService.verifyMagicLink напряму інжектить LandingClaimService і викликає `attemptLandingClaim` всередині verify-flow.
- StorageService напряму інжектить UsersService для commitAvatar / deleteAvatar (читає user.profile.avatar, оновлює профіль, чистить старий URL).

Інверсія в обох точках усуває справжню петлю DI-графа. Залишковий цикл Auth ↔ Users (видалення акаунта потребує revoke-токенів) — єдиний справжній bidirectional cycle, він канонічно живе під двома forwardRef-ами.

## Питання

### 1. Підхід для Auth → LandingClaim

Два варіанти інверсії:

- **А1. Синхронна подія через @nestjs/event-emitter (emitAsync).**
  AuthService емітить `MagicLinkVerifiedWithDraftEvent`, LandingClaimListener слухає, повертає claim-result через Promise. AuthService збирає response. Реалізаційно простіше, AuthModule просто не імпортує LandingClaim. Архітектурний компроміс — подія, що очікує результат, семантично залишається викликом через посередника. Тестабельність: треба мокати EventEmitter.

- **А2. Перенесення оркестрації на рівень AuthController.**
  AuthService.verifyMagicLink повертає тільки auth-result + сирий payload з Redis. AuthController читає `payload.landingDraft + claimIdempotencyKey`, викликає LandingClaimService напряму, merge у response. AuthService нічого не знає про LandingClaim взагалі. Більший рефактор: треба адаптувати terms-pre-stamp order, retry-flow, схему повернення payload з service.

**Відповідь:** А2. Оркестрація claim переїздить у AuthController; AuthService про LandingClaim нічого не знає. Це справжня інверсія, а не подія-через-посередника.

### 2. Скоуп для Storage → Users

- **Б1. Окремий AvatarService у UsersModule.**
  Перенести commitAvatar / deleteAvatar оркестрацію з StorageService у новий AvatarService, який живе у UsersModule і викликає StorageService для file-ops + UsersService для profile-update. StorageController перемикається на AvatarService. StorageService стає pure file-ops (presign, head, upload buffer, delete by key). Storage перестає знати про Users.

- **Б2. Залишити Storage→Users цикл закритим forwardRef-ом, а не рефактором.**
  Тільки Auth→LandingClaim розв'язуємо чисто. Storage отримує єдиний `forwardRef(() => UsersModule)` як прагматичний компроміс — мінімум коду, але архітектурний борг залишається у `tech-backlog.md`.

**Відповідь:** Б1. Розв'язуємо обидва цикли чисто. Storage стає pure file-ops, оркестрація аватарки переїздить у окремий сервіс всередині UsersModule.

### 3. Контракт response magic-link verify

Зараз `POST /auth/magic-link/verify` повертає `data` зі spread-ом claim-полів на верхньому рівні: `{ user, accessToken, purpose, claimState?, claimedBusinessSlug?, ... }`. Frontend читає `data.claimState` як discriminator у trio-state.

- **В1. Зберігаємо існуючий shape.** Будь-яка інверсія всередині backend прозора для frontend; verify-page-handler не чіпається.
- **В2. Дозволяємо зміну shape** на вкладений об'єкт (наприклад, `data.claim: { state: 'success', businessSlug, accountSlug }`). Чистіший type-design, але потребує синхронної міграції frontend verify-page-handler і всіх місць, які читають claim-fields.

**Відповідь:** В2+. Вкладений об'єкт `claim: LandingClaimResult | null` АЛЕ з single source of truth — `LandingClaimResult` виноситься з api-internal у `packages/types/src/contracts/landing-claim.ts` як shared Zod discriminated union. `MagicLinkVerifyResponse` після цього посилається на shared-тип. Frontend читає той самий тип. TS catches усі call-sites при міграції — не "тиха" регресія. Симетрично з рішеннями 2-3: claim — не справа auth, його контракт теж окремий. Breaking change у API-shape, описуємо у README спринту явно.

### 4. Terms-pre-stamp order у новій схемі

Існуючий порядок у `AuthService.verifyMagicLink` (Sprint 10 fix): auth-resolve → stampAcceptedTerms → attemptLandingClaim. Інваріант "терми застемплені ДО claim attempt" — критичний (без нього frontend `acceptTerms()` post-claim throw на network glitch лишав би state з Business+Account без terms-stamp).

- **Г1.** Terms-stamp залишається у AuthService (інфраструктурна частина auth). Claim переноситься у controller / listener. Порядок зберігається на рівні controller orchestration.
- **Г2.** Terms-stamp теж виходить з AuthService у окремий orchestrator. AuthService стає максимально вузьким (тільки `findOrCreateByEmail + generateTokens`).

**Відповідь:** Г2. Stamp теж виходить з AuthService. AuthService стає чисто механічним (validate token + find/create user + generate tokens). Логічна симетрія з Г1: винесли claim — виносимо і stamp. Інваріант "stamp ДО claim" захищається порядком викликів у контролері (тонкий, ревʼюйний, покритий e2e).

### 5. Розблокування dev-середовища

Зараз `docker compose -f docker-compose.dev.yml` не стартує — це блокатор для будь-якої роботи через docker.

- **Д1. Тимчасовий forwardRef як unblocker.** Перший крок спринту — два точкові `forwardRef` у `storage.module.ts` і `landing-claim.module.ts` з TODO-коментарем посилання на цей спринт. Працюємо над рефактором на робочому dev-середовищі. Останній крок спринту видаляє ці forwardRef.
- **Д2. Стартуємо рефактор з зламаного стану.** Без проміжного unblocker — перший комміт уже виконує справжній розрив циклу. Дев-сервер у docker не запускається до моменту merge-у; локальний `pnpm --filter api dev` працює (старий node_modules cache обходить цикл).

**Відповідь:** Д1. Tactical unblocker за фактом виконано — `forwardRef(() => UsersModule)` уже додано у `storage.module.ts` + `storage.service.ts`. Перший комміт спринта — закомітити цей unblocker з TODO-коментарем на Sprint 13. Останній комміт спринта — видалити forwardRef разом з імпортом UsersModule (StorageModule після рефактору взагалі не залежить від UsersModule).

### 6. Скоуп тестів у тому ж спринті

`AuthService.verifyMagicLink` має e2e-кейси (`auth.e2e-spec.ts`) і unit-spec-и з expectations на synchronous claim-result. `LandingClaimService.spec` тестує `attemptLandingClaim` напряму. Якщо контракт response змінюється або orchestration переїздить — тести треба адаптувати.

- **Е1. Тести у тому ж спринті.** Рефактор + всі тести в одному merge-flow. Гарантія, що поведінка не регресувала.
- **Е2. Тести у окремому follow-up спринті.** Спочатку код, потім окремо тестова hardening. Швидше до merge основного PR, але є вікно з застарілими тестами.

**Відповідь:** Е1. Рефактор + усі тести в одному merge-flow. Спринт без тестів = політ без приладів саме там, де змінюється порядок критичних інваріантів (stamp ДО claim). Окремий тест-spec на `AuthController.verifyMagicLink` (нова оркестрація) + `AvatarService.spec` (переїзд логіки з storage.service.spec). E2e на magic-link verify переписуються під новий shape response.

### 7. Storage → Users якщо обрано Б1 — назва нової сервіс-абстракції

Якщо рефакторимо Storage→Users (відповідь Б1 на питання 2), новий orchestration-сервіс умовно називаю `AvatarService`. Він живе у UsersModule і inject-ить StorageService + UsersService.

- **Є1.** Назва `AvatarService` — точно описує scope (тільки avatar). Якщо у майбутньому додаються інші user-owned files (наприклад, business-logo) — додається `LogoService` поряд.
- **Є2.** Назва ширша, наприклад `UserMediaService` — одна абстракція для всього user-owned-storage. Менше фрагментації, але broader scope наперед.

**Відповідь:** Є1. `AvatarService`. Принцип "не вигадуй абстракцію, поки не маєш двох use-case-ів". Коли з'явиться логотип бізнесу — окремий `LogoService` або рефактор у broader-сервіс на реальних патернах.
