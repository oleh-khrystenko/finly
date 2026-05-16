# Sprint 13. Dependency Inversion

## Мета і контекст

Розв'язати дві реальні петлі модульних залежностей у NestJS-графі (`AuthModule` ↔ `LandingClaimModule` ↔ `UsersModule` ↔ `AuthModule` та `StorageModule` ↔ `UsersModule` ↔ `AuthModule` ↔ `StorageModule`) через інверсію залежностей, а не через косметичне прикриття `forwardRef`. Сьогодні `docker compose -f docker-compose.dev.yml` падає з `UndefinedModuleException` на StorageModule і LandingClaimModule. На рівні Nest-scanner петлі формально закриті `forwardRef`, але на CJS-evaluation декоратор `@Module` отримує `undefined` через те, що метаdata.imports читається до завершення evaluation сусідньої class declaration.

Інфраструктурні модулі (Auth займається токенами і сесіями, Storage займається файлами в R2) перестають знати про бізнес-фічі (LandingClaim, який конвертує анонімний драфт у бізнес+рахунок) і про доменну сутність верхнього рівня (User). Це фіксує справжню одну з провідних причин фрагментованості: AuthService сьогодні робить три речі поспіль (auth, terms-stamp, claim) і поняття зон відповідальності розмиті.

Залишковий цикл Auth ↔ Users (видалення акаунта потребує revoke токенів) є єдиним справжнім bidirectional cycle. Він канонічно живе під двома `forwardRef` і не порушує CJS-evaluation, бо не залучає декоратор-метаdata.

## Скоуп

- [ ] Tactical unblocker для docker dev (комітимо вже виконану зміну з `forwardRef(() => UsersModule)` у StorageModule, з посиланням на цей спринт у TODO).
- [ ] Виносимо `LandingClaimResult` як shared Zod discriminated union у `packages/types`.
- [ ] Міняємо контракт `POST /auth/magic-link/verify`: claim-поля переїздять з плоского spread у вкладений об'єкт `claim`, посилання на shared тип.
- [ ] `AuthService.verifyMagicLink` стає механічним: validate magic-token, find or create user, generate tokens, повернути сирий payload з Redis для оркестрації. Без terms-stamp, без claim.
- [ ] `AuthController.verifyMagicLink` стає оркестратором: викликає AuthService, потім (за наявності termsVersion) UsersService.stampAcceptedTerms, потім (за наявності draft) LandingClaimService.attemptLandingClaim, склеює response з shared-типом.
- [ ] AuthModule більше не імпортує LandingClaimModule. LandingClaimModule імпортується безпосередньо в AuthController через окремий module-провайдер на рівні контролера (LandingClaimModule стає peer-залежністю AuthController, а не AuthService).
- [ ] Виносимо аватарну оркестрацію (commit, delete, re-upload з зовнішнього URL) у новий AvatarService всередині UsersModule.
- [ ] StorageService стає чистим файл-провайдером: presign URL, head, upload buffer, delete by key, build public URL, isR2Url, extractKeyFromR2Url. Жодних звернень до UsersService, жодного знання про user.profile.avatar.
- [ ] StorageController перемикається з StorageService на AvatarService.
- [ ] StorageModule видаляє `imports: [UsersModule]` і `forwardRef`. Експортує StorageService для consumers, що працюють тільки з файлами.
- [ ] AuthService.handleGoogleAuth перемикається з `storageService.reUploadExternalAvatar` (старий шлях, який всередині оновлював профіль) на новий AvatarService.reUploadExternalAvatar (повна синхронна re-upload + profile-update пара).
- [ ] Frontend міграція читання claim-payload з `data.claimState / data.claimedBusinessSlug / ...` на `data.claim?.state / data.claim?.businessSlug / ...` у verify-page-handler і у claim-flow hook-у.
- [ ] Тести у тому ж merge-flow: новий unit-spec на AuthController.verifyMagicLink, новий AvatarService.spec, переписаний AuthService.verifyMagicLink-spec під вужчу поверхню, переписаний auth.e2e-spec під новий response-shape, оновлені web-тести на claim-readers.
- [ ] Видалення `forwardRef` зі StorageModule як останній комміт спринту (cleanup-крок).

## НЕ-скоуп

- Не виносимо stamp-acceptedTerms у окремий orchestration-сервіс. Він лишається методом UsersService, контролер просто викликає його у потрібний момент.
- Не міняємо domain-логіку LandingClaim, BusinessesService, AccountsService, retry-on-11000.
- Не міняємо контракти Storage-public-API на рівні endpoints (POST avatar/upload-url, POST avatar/commit, DELETE avatar). Міняється лише, який сервіс їх обслуговує всередині.
- Не розв'язуємо цикл Auth ↔ Users (видалення акаунта потребує revokeRefresh). Це справжній bidirectional cycle, він залишається з двома `forwardRef`.
- Не торкаємось Google-OAuth-flow поза точкою заміни виклику reUploadExternalAvatar.
- Не торкаємось CJS vs ESM конфігурації білдів. Рефактор знімає симптом без зміни module-формату.

## Архітектурні рішення

### 1. AuthService стає чисто механічним

verifyMagicLink повертає або об'єкт з полями user, tokens, purpose, accountDeleted, rawPayload (де rawPayload містить termsVersion, landingDraft, claimIdempotencyKey з Redis), або state видалення акаунта (без змін, окремий гілка). Жодних викликів usersService.stampAcceptedTerms, жодних викликів landingClaimService.attemptLandingClaim. Це інвертує два concerns одночасно.

### 2. AuthController стає оркестратором magic-link verify

Послідовність кроків стає буквальною читаною інструкцією: викликати AuthService.verifyMagicLink, якщо є termsVersion, викликати UsersService.stampAcceptedTerms, якщо є draft, викликати LandingClaimService.attemptLandingClaim, склеїти фінальний response. Інваріант "stamp ДО claim" живе в одному місці у вигляді явного порядку викликів. Це найкритичніша точка коду в спринті, вона покривається unit-spec-ом на контролер плюс e2e на verify-flow.

### 3. Інверсія LandingClaim на рівні класів, не module-graph

AuthService не отримує LandingClaimService у конструктор взагалі. Це і є справжня інверсія, бо саме клас-знання було джерелом змішування concerns. Module-graph навколо LandingClaim практично не змінюється: AuthModule продовжує імпортувати LandingClaimModule, бо AuthController (резидент AuthModule) inject-ить LandingClaimService для оркестрації. Це не косметика і не повернення петлі: реальний CJS-evaluation crash сьогодні тільки у Storage, бо storage.module.ts завантажується глибше у chain (AuthModule імпортує LandingClaim перед Storage, і LandingClaim встигає resolveнути Users до того, як ланцюг доходить до Storage). LandingClaim-петля у поточному граф-order проходить через forwardRef на Users↔Auth без проблем. Тому module-cleanup у LandingClaim не вимагається. AuthModule зберігає короткий явний коментар, який пояснює саме це майбутньому ревʼюеру.

### 4. LandingClaimResult стає shared контрактом

Тип переноситься з api-internal у packages/types як Zod discriminated union (за полем state). Backend LandingClaimService повертає той самий тип. MagicLinkVerifyResponse у packages/types позбавляється плоских claim-полів і отримує поле claim, яке або null, або значення shared-union. Frontend читає той самий тип через @hookform/resolvers або через api-mappers. TS catch-ить усі call-sites при міграції, тиха runtime-регресія структурно неможлива.

### 5. Storage стає pure file-ops

StorageService експонує тільки операції над файлами: створення presigned upload URL для довільного ключа, HeadObject metadata, upload буфера, delete by key, build public URL, isR2Url, extractKeyFromR2Url. Жодного знання про user, жодного звернення до моделі User. Helper-методи safeDeleteR2File і safeDeleteKey лишаються всередині StorageService, бо вони про файли, не про користувача.

### 6. AvatarService володіє доменом аватарки

Новий сервіс живе у UsersModule. Inject-ить StorageService (для файл-операцій) і модель User напряму (як інші users-сервіси). Бере на себе три речі: createAvatarUploadUrl, commitAvatarUpload (вся оркестрація з ownership-check, namespace-check, idempotency-guard, HeadObject-validation, profile-update, safeDeleteR2File старого URL), deleteAvatar, reUploadExternalAvatar (fetch external URL, sharp re-encode, upload, оновлення профілю). StorageController перемикається на цей сервіс. AuthService.handleGoogleAuth викликає AvatarService.reUploadExternalAvatar замість старого StorageService-методу.

## Контракти

### Shared тип

`packages/types/src/contracts/landing-claim.ts` отримує Zod discriminated union LandingClaimResultSchema і inferred TypeScript-тип LandingClaimResult з трьома станами:

- state success з полями claimedBusinessSlug, claimedAccountSlug.
- state business-failed з полем failedClaimDraft.
- state account-failed з полями partialBusinessSlug, failedClaimDraft.

LandingDraftSchema вже існує у packages/types, використовується як підмодуль.

### Response shape

MagicLinkVerifyResponseSchema позбавляється плоских полів claimState, claimedBusinessSlug, claimedAccountSlug, partialBusinessSlug, failedClaimDraft. Натомість отримує поле claim, яке або null (claim не виконувався, наприклад звичайний login без draft), або значення LandingClaimResultSchema. Discriminated narrowing тепер на claim.state, а не на claimState.

Це breaking change у публічному API. Mono-repo має єдиного клієнта (apps/web), міграція відбувається атомарно у тому самому merge-у. Якщо у майбутньому з'являться інші клієнти (mobile, інтеграція), shape вже буде у фінальній чистій формі.

### Endpoints

Жоден HTTP endpoint не змінює свій шлях, метод чи auth-зону. Змінюється тільки тіло response одного endpoint (verify magic-link). Storage-endpoints (POST avatar/upload-url, POST avatar/commit, DELETE avatar) ідентичні зовні, всередині перемикаються на AvatarService.

## UI / UX

Сторінка верифікації magic-link на frontend читає claim-state з нового вкладеного поля. Три гілки UX залишаються незмінними (success-redirect на cabinet, business-failed redirect на /business/new з прохідним draft, account-failed redirect на /account/new з partialBusinessSlug). Інших змін UI немає, спринт інфраструктурний.

## Послідовність виконання

1. Закомітити tactical unblocker (вже виконано локально, поточний diff). Один комміт з TODO-коментарем на цей спринт.
2. Винести LandingClaimResult у packages/types, оновити landing-claim.service.ts на shared-тип, rebuild types.
3. Оновити MagicLinkVerifyResponseSchema на claim-вкладений-об'єкт. Тимчасово ламаються web-тести і e2e — це очікувано.
4. Створити AvatarService у UsersModule (повна логіка аватарки). StorageController ще на старому шляху.
5. Перемкнути StorageController на AvatarService.
6. Перемкнути AuthService.handleGoogleAuth на AvatarService.reUploadExternalAvatar.
7. Витерти аватарну логіку зі StorageService, залишити тільки pure file-ops. Видалити імпорт UsersService, прибрати forwardRef з конструктора.
8. Звузити AuthService.verifyMagicLink: прибрати stamp-call, прибрати claim-call. Повертає raw payload.
9. Перемкнути AuthController.verifyMagicLink на нову оркестрацію. Викликає AuthService, stamp, claim у явному порядку.
10. Видалити landingClaimService з конструктора AuthService.
11. Останній комміт: видалити `forwardRef(() => UsersModule)` зі StorageModule, видалити `imports: [UsersModule]`. Перевірити, що docker dev стартує без unblocker.
12. Прогнати lint, type-check, всі unit/e2e тести зеленими.

## Тести

- Новий unit-spec на AuthController.verifyMagicLink. Покриває чотири сценарії: звичайний login без draft без termsVersion, login з termsVersion (stamp викликаний), magic-link з draft (success-claim, claim у response), magic-link з draft (account-failed, claim.state у response). Порядок stamp-ДО-claim verifying-ється expect-ами на mock call order.
- Новий AvatarService.spec. Переїзд логіки з storage.service.spec, плюс розширення на race-сценарій (профіль зник між findById і updateProfile, orphan-file cleanup).
- Переписаний AuthService.spec. Вужча поверхня: тестує тільки validate-token, find-or-create-user, generate-tokens. Прибраний mock на LandingClaimService і на stampAcceptedTerms.
- Переписаний auth.e2e-spec на новий response-shape. Перевірка trio-states тепер через `body.data.claim.state`.
- Оновлені web-тести на claim-readers (verify-page-handler, useClaimLandingDraft).
- StorageService.spec звужується разом зі звуженням сервіса. Avatar-сценарії переїздять у AvatarService.spec.

## Ризики

- Реструктуризація AuthModule імпортів. AuthController резидент AuthModule, тому LandingClaimModule все одно має бути імпортований у AuthModule. Інверсія тут на рівні класового знання (AuthService не inject-ить LandingClaimService), а не на рівні module-graph. Це чесний trade-off і його треба зафіксувати у коментарі AuthModule, щоб майбутній рев'юер не подумав, що петля повернулась.
- CJS-evaluation order. Поточний баг проявляється саме на docker dev. Після видалення forwardRef треба обов'язково запустити docker compose dev і прод-like docker compose, переконатися що обидва стартують. Без цього merge ризикований.
- E2E на magic-link verify покривають lock-step між backend і frontend. Якщо хоча б один спрінт-крок міняє контракт у відриві (наприклад, оновлений schema у packages/types без re-build), e2e падають з cryptic stack. Re-build types після кроку 2 обов'язковий.
- Frontend міграція claim-readers. TypeScript ловить усе, але є місця, які читають payload з generic-типу (axios-response cast). Перевірити, що apiClient.post у verify-handler типізований через shared response-тип, а не через `any`.

## Definition of Done

- docker compose -f docker-compose.dev.yml стартує без forwardRef у StorageModule.
- docker compose стартує у прод-like режимі.
- AuthModule не має StorageModule у imports. StorageModule не має UsersModule у imports.
- AuthService не має LandingClaimService у конструкторі. StorageService не має UsersService у конструкторі.
- packages/types експортує LandingClaimResultSchema і LandingClaimResult. MagicLinkVerifyResponseSchema містить вкладений claim замість плоских полів.
- Всі unit-тести зелені, e2e зелені, web-тести зелені.
- Lint, type-check без помилок.
- Manual UAT entry додано (за необхідності) у docs/manual-checks/README.md з пунктом перевірки magic-link verify трьох trio-states після рефактору.
