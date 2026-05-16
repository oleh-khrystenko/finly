# Sprint 12 — Orphan-Business cleanup: email-pipeline + cron-deletion

> **Статус (на 2026-05-11):** заплановано, не стартував.
> **Передумови:** Sprint 9 (Account-схема готова, Business + Account існують як окремі сутності), Sprint 10 (`LandingClaimService.attemptLandingClaim` повертає stamped state для claim-success, але без `pendingPostLoginTarget`-stamp-у), Sprint 11 (`User.pendingPostLoginTarget`-поле + `UsersService.setPendingPostLoginTarget` + AuthInitializer cold-login consume). Усі — функціонально закриті.
> **Що розблокує:** clean-БД invariant ("orphan-Business не накопичуються довше тижня"); compliance evidence ("user попереджений 2 рази перед видаленням"); закриває ризик #14 з Sprint 9 (orphaned Business+Account на abandoned magic-link claim) повністю.
> **Контекст рішень:** вступний контракт і архітектурні рішення — у [`planning-questions.md`](planning-questions.md). Цей README — імплементаційна механіка.
> **Production-data:** ще немає. Якщо до моменту імплементації Sprint 12 dev-environment-и матимуть тестові orphan-документи Sprint 9-11, dropDatabase + чистий старт. Тестові fixture для cron — створюються у spec через `MongoMemoryReplSet`.

---

## Мета

Закрити останній відкритий edge-case anon-claim flow: phone-користувач, який відкрив магічне посилання, але не дозаповнив firstName/lastName до закриття табу, лишає orphan-Business+Account у БД. Зараз orphan-state накопичується назавжди — це засмічує БД, ламає аналітику ("скільки реальних активних бізнесів") і не відповідає юридичній очікуваності "user-data не зберігається без явної згоди".

Sprint 12 додає автоматичне щоденне cron-завдання, що:

1. Знаходить users з `firstName` empty/missing OR `lastName` empty/missing AND існує ≥1 Business з `ownerId = user._id`.
2. На 1-й день після створення найстаршого Business — відправляє soft-reminder email "Дозаповніть профіль".
3. На 6-й день — final-warning email "Завтра рахунок буде видалено".
4. На 7-й день — cascade-видаляє всі Business + Account + Invoice + InvoiceSlugCounter цього user-а.

Конкретні дні конфігуровані через env-vars з cross-field invariant. User-документ сам НЕ видаляється — лишається з incomplete-profile; login можливий, AuthGuard-onboarding-redirect спрацює як зараз.

---

## Скоуп

### Backend (`apps/api`)

- 🔲 Новий `apps/api/src/modules/users/orphan-profile-cleanup.service.ts` — cron-service з `@Cron('0 5 * * *', { timeZone: 'Europe/Kyiv' })` (5 AM Kyiv щодоби; не співпадає з PaymentsCleanupService 4 AM і CleanupService 6h-bucket-у). Реєструється у `UsersModule`-providers.
- 🔲 `UsersService` отримує 4 нових methods (sibling до existing CleanupService-related-helpers):
    - `stampProfileCompletionReminder(userId, stage: 'first' | 'final'): Promise<boolean>` — atomic `findOneAndUpdate` з conditional-filter (для `stage='first'` — `{ 'profileCompletionReminders.firstReminderSentAt': null }`; для `stage='final'` — `{ 'profileCompletionReminders.finalWarningSentAt': null, 'profileCompletionReminders.firstReminderSentAt': { $ne: null } }`, тобто prereq-guard включений у filter atomically) → `$set: { 'profileCompletionReminders.{stage}ReminderSentAt': new Date() }`. Returns `boolean` (matchedCount > 0). Cron-caller перевіряє: `true` → ми claim-нули, продовжуємо до email-send; `false` → інший cron-instance вже claim-нув або prereq-guard відхилив, skip.
    - `resetSingleStamp(userId, stage: 'first' | 'final')` — НЕ-conditional `$set: { 'profileCompletionReminders.{stage}ReminderSentAt': null }`. Викликається cron-ом тільки на email-send-failure path-у для revert-у щойно-stamped-стану (щоб наступний cycle повторив attempt).
    - `resetProfileCompletionReminders(userId)` — `User.updateOne({ _id }, { $set: { 'profileCompletionReminders.firstReminderSentAt': null, 'profileCompletionReminders.finalWarningSentAt': null } })`. Викликається після Stage-3 cascade-deletion full-success-завершення (history-bucket consumed; якщо user знову створить orphan-Business, цикл стартує заново).
- 🔲 `User.profileCompletionReminders`-sub-doc (Mongoose-схема `user.schema.ts`): `@Prop({ type: { firstReminderSentAt: { type: Date, default: null }, finalWarningSentAt: { type: Date, default: null } }, _id: false, default: () => ({ firstReminderSentAt: null, finalWarningSentAt: null }) })`. Без index — поле read-ється тільки в context cron-iteration aggregation-pipeline, без queries-by-stamp.
- 🔲 Алгоритм `OrphanProfileCleanupService` per-iteration:
    - **Aggregation pipeline** на `User` collection: `$match` users з incomplete-profile (firstName empty/missing OR lastName empty/missing) + `$lookup` на `Business` через `ownerId` (alias `orphanBusinesses`) → `$match` users з `orphanBusinesses.length ≥ 1` → `$addFields { oldestBusinessAge: { $subtract: [now, { $min: '$orphanBusinesses.createdAt' }] } }`. Pipeline не робить `$unset orphanBusinesses` — повний array з name+createdAt+slug потрібен для email-template.
    - **forEach в Node.js** — per-user evaluator визначає **рівно один** active stage (highest-priority серед тих, що pass-ують умови; ordering: Stage 3 > Stage 2 > Stage 1).
    - **Per-stage threshold + prereq-guard rules**:
        - Stage 1 fires when: `oldestBusinessAge ≥ ORPHAN_REMINDER_FIRST_DAYS` AND `firstReminderSentAt === null`. No prereq — entry-point pipeline-у.
        - Stage 2 fires when: `oldestBusinessAge ≥ ORPHAN_REMINDER_FINAL_DAYS` AND `finalWarningSentAt === null` AND **`firstReminderSentAt !== null`** (prereq-guard).
        - Stage 3 fires when: `oldestBusinessAge ≥ ORPHAN_CLEANUP_DELETION_DAYS` AND **`finalWarningSentAt !== null`** (prereq-guard).
    - **Cron-downtime resilience invariant**: якщо cron був недоступний 7+ днів (deploy-window, infra-incident), prereq-guards гарантують graceful degradation. На post-downtime-run user з age=8 і обома stamps null отримує Stage 1; next-day cron-iteration — Stage 2; day-after — Stage 3. Email-trail invariant "user попереджений 2 рази перед cleanup" фізично збережено незалежно від cron-availability-history.
    - **Per-cycle one-stage-only invariant**: cron-iteration fires максимум один stage per user (Stage 1 OR Stage 2 OR Stage 3 — не два за один день). Природно випливає з prereq-guards.
- 🔲 **Stage 1 / 2 send-flow (claim-first pattern)**:
    1. `stampProfileCompletionReminder(userId, stage)` — atomic claim з conditional-filter (включно з prereq-guard для `'final'`).
    2. `matchedCount === 0` → skip (no email send): або інший concurrent cron-instance уже claim-нув, або prereq-guard відхилив (Stage 2 без Stage 1 stamp у race-window).
    3. `matchedCount > 0` → claim-нули → `await EmailService.send...(...)` → success no-op, on failure → `resetSingleStamp(userId, stage)` (revert до null) + log error → наступний cron-cycle спробує знову.
    4. **Чому claim-first, а НЕ send-first**: send-first дає race "double-fire-paralleled-crons" — обидва конкурентні cron-instance читають `null`, обидва відправляють лист, потім обидва stamp-ять (atomic-filter ловить тільки другий, але два листи вже пішли). Claim-first гарантує: на race перший atomic-claim проходить, другий no-op-ить ДО send-у; trade-off "fail-after-stamp" закривається через explicit `resetSingleStamp` на email-failure.
- 🔲 **Stage 3 cascade-deletion (partial-success-resilient ordering)**:
    1. Resolve list of all `ownerId === user._id`-businesses через окремий query (sorted by createdAt asc для deterministic-order).
    2. forEach business — call `BusinessesService.delete(business)` (existing сигнатура з `apps/api/src/modules/businesses/businesses.service.ts`; reuse existing cascade-flow з `withTransaction`-pattern). На success — продовжити loop; на failure — log error + break loop (не продовжуємо, бо partial-cascade гірший за консервативний skip).
    3. **Reset reminders ТІЛЬКИ на full-success**: після loop `Business.countDocuments({ ownerId: user._id })`. Якщо `=== 0` (всі orphan-business-и видалені) → `UsersService.resetProfileCompletionReminders(userId)` + `UsersService.clearPendingPostLoginTarget(userId)` (history-bucket consumed; cycle restart-ується якщо user знову створить orphan-Business). Якщо `> 0` (loop crash-нув mid-way, частина business-ів лишилася) → reminders НЕ reset-ляться, наступний cron-cycle (день 8/9/...) знову запустить Stage 3 для решти.
    4. **Чому НЕ reset-after-each-business у loop**: race "deleted-1-of-2-then-reset-reminders-then-crash" → user-doc показує "no recent reminder", наступний cron-cycle відправить duplicate-email (Stage 1 знов через 1-day check), хоча final-deletion вже половинчасто-виконано. Conservative "reset-only-on-full-success" гарантує stamps lifetime → cron-retry-resilient без email-spam.
    5. **Replica-set requirement** (Sprint 4 §4.0): cascade-delete-business у Stage 3 використовує existing `BusinessesService.delete`-flow з `withTransaction`. Standalone-Mongo-environment кидає `CASCADE_DELETE_REQUIRES_REPLICA_SET`. Production Atlas — without issue.
- 🔲 **Multi-business semantics**: ФОП теоретично міг створити кілька orphan-Business через repeated magic-link-claim до dozаповнення профіля. Email-template приймає `businesses: Business[]` і рендерить inline-list з business-name-ів через кому. UA-pluralization "ваш бізнес" / "ваші бізнеси" — через існуючу UA-pluralization-конвенцію проєкту (наприклад `Intl.PluralRules('uk')` або if/else на length). Найстарший business визначає `oldestBusinessAge` для stage-threshold-check (раніше за 1/6/7-day cutoff від найстаршого orphan-у, не від кожного окремо — інакше user отримає три первинні reminder-листи через 3 послідовні дні якщо створив 3 business-и через 3 дні).
- 🔲 **Email templates у `apps/api/src/modules/email/templates/`** (per `docs/conventions/tone.md` classic-polite — без exclamation-mark-ів, без casual-greeting "Привіт", на "ви", лаконічно):
    - `profile-completion-reminder.tsx` — soft-tone (Stage 1, 1-day). Props shape: `{ businesses: Array<{ name: string }> }`. Single UA-копія: "Доброго дня. Ви створили бізнес «{businessName}» через Finly, але ще не дозаповнили профіль (імʼя і прізвище). Завершіть налаштування у кабінеті, щоб зберегти рахунок і виставляти інвойси клієнтам. Без заповненого профілю рахунок буде автоматично видалено через 7 днів від створення бізнесу." Multi (≥2): "Доброго дня. Ви створили {N} бізнеси через Finly: «{name1}», «{name2}»{, ...}, але ще не дозаповнили профіль. Завершіть налаштування у кабінеті, щоб зберегти рахунки. Без заповненого профілю всі рахунки буде автоматично видалено через 7 днів від створення першого бізнесу." UA-pluralization "бізнес/бізнеси/бізнесів" і "рахунок/рахунки" — через `Intl.PluralRules('uk-UA')` або if/else на length. CTA-button "Заповнити профіль" → `{WEB_URL}/profile?mode=new&next=/business`.
    - `profile-completion-final-warning.tsx` — urgent-tone (Stage 2, 6-day), urgency через формулювання "Це останнє нагадування", не через exclamation-mark-и. Той самий props-shape. Single UA-копія: "Доброго дня. Завтра бізнес «{businessName}» буде остаточно видалено через незаповнений профіль. Це останнє нагадування. Завершіть налаштування у кабінеті, щоб зберегти дані." Multi (≥2): "Доброго дня. Завтра {N} бізнеси «{name1}», «{name2}»{, ...} буде остаточно видалено через незаповнений профіль. Це останнє нагадування. Завершіть налаштування у кабінеті, щоб зберегти дані." Той самий CTA-button.
    - **Жодних exclamation-mark-ів, casual-greeting-ів, або панібратської мови** — порушує tone.md classic-polite-rule. "Доброго дня" — стандартне формальне привітання, symmetric до Sprint 1 magic-link-template і Sprint 7 password-reset-template.
    - Українською; reuse existing `templates/layouts/base.tsx` з `<Html lang="uk">`; форматування дати через `DATE_LOCALE = 'uk-UA'` константу + `formatDate()`-helper.
- 🔲 **`apps/api/src/modules/email/translations.ts` — нова секція `EMAIL_TEXT.profileCompletion`** з sub-keys: `reminder.singleSubject`, `reminder.multiSubject`, `reminder.singleBody`, `reminder.multiBody`, `reminder.cta`, `finalWarning.singleSubject`, `finalWarning.multiSubject`, `finalWarning.singleBody`, `finalWarning.multiBody`, `finalWarning.cta`. Single-locale (uk only) — без `t()`-call-у, прямі string-values. Symmetric до існуючих `EMAIL_TEXT`-секцій Sprint 1 (magic-link, password-reset). **Якщо `translations.ts` файл ще не існує у проєкті** на момент імплементації Sprint 12 (бо `tone.md` §Patterns його декларує як convention, але до цього спринту жоден email-template його не використовував) — створюємо файл у цьому спринті з тільки `EMAIL_TEXT.profileCompletion`-section; existing templates (magic-link, password-reset, business-deletion) можуть бути мігровані як окремий tech-debt-ticket поза скоупом цього спринту. Якщо файл існує — додаємо нову секцію поряд.
- 🔲 **`apps/api/src/modules/email/email.service.ts` — два нові методи**:
    - `sendProfileCompletionReminder({ user, businesses }: { user: UserDocument; businesses: BusinessDocument[] })` — Resend-API call з `profile-completion-reminder.tsx` template, props `{ businesses: businesses.map(b => ({ name: b.name })) }` (mapping мінімізує template-shape до single name-field — ні IBAN, ні taxId не expose-ляться у email-body, бо security-best-practice "email-content readable у inbox-screenshots і forwarded-чейнах"). `businesses` гарантовано non-empty (cron-aggregation `$match orphanBusinesses.length ≥ 1` filter). Method-implementation резолвить копію з `EMAIL_TEXT.profileCompletion.reminder`-map і pas-ує у template-props.
    - `sendProfileCompletionFinalWarning({ user, businesses })` — symmetric для final-warning template.
    - kwargs-style сигнатури (per project conventions).
- 🔲 **`apps/api/src/config/env.ts` — три нові required env-змінні + cross-field invariant**:
    - `ORPHAN_REMINDER_FIRST_DAYS` (default 1, integer ≥ 1).
    - `ORPHAN_REMINDER_FINAL_DAYS` (default 6, integer).
    - `ORPHAN_CLEANUP_DELETION_DAYS` (default 7, integer).
    - Cross-field invariant: `ORPHAN_REMINDER_FIRST_DAYS < ORPHAN_REMINDER_FINAL_DAYS < ORPHAN_CLEANUP_DELETION_DAYS` (fail-fast on app-boot з зрозумілим повідомленням; інакше cron-stages overlap і email-spam стає можливим — наприклад, default=2/2/2 змусив би всі 3 stage-и спрацювати в один день).
    - Документуються у `.env.example` з коментарями.

### Shared (`@finly/types`)

- 🔲 `entities/user.ts` рефакторинг — додати `profileCompletionReminders: z.object({ firstReminderSentAt: z.date().nullable(), finalWarningSentAt: z.date().nullable() }).default({ firstReminderSentAt: null, finalWarningSentAt: null })`.
- 🔲 Tests: spec на entity-Zod `user.spec.ts` — round-trip serialization з default-shape + non-null state-shape.

### Cross-cutting docs

- 🔲 `CLAUDE.md`:
    - Domain Model — `User` додати `profileCompletionReminders`-sub-doc.
    - Module Dependency Map — `OrphanProfileCleanupService` як новий cron у `UsersModule` (sibling до `CleanupService` + `ReservationReconcileService`).
    - Configuration — додати три нові env-vars + cross-field invariant до "API — ALL required" списку.
    - Known Complexities — новий пункт "Orphan-Business cleanup-pipeline з 3-stage email-pipeline і prereq-guards для cron-downtime resilience".
- 🔲 `docs/manual-checks/README.md` — нові UAT-пункти:
    - **ORPHAN-1 — Stage 1 reminder.** Створити user через magic-link (signup-flow, без firstName/lastName) + claim з лендінгу → orphan-Business зі`createdAt = now`. Поставити `ORPHAN_REMINDER_FIRST_DAYS=0` через env-override на staging → cron на 5 AM запуститься з age ≥ 0 + обома stamps null → user отримує reminder email. Verify: лист у inbox-у з правильним business-name, CTA "Заповнити профіль" веде на `/profile?mode=new&next=/business`. БД-state: `firstReminderSentAt` non-null, `finalWarningSentAt` null.
    - **ORPHAN-2 — Stage 2 final-warning.** Той самий user-state + `ORPHAN_REMINDER_FINAL_DAYS=0`, `ORPHAN_REMINDER_FIRST_DAYS=0` → cron run раз → Stage 1 fires (per-cycle one-stage). Cron run другий раз (наступний день) → Stage 2 fires (prereq-guard `firstReminderSentAt !== null` pass) → final-warning email. БД-state: обидва stamps non-null.
    - **ORPHAN-3 — Stage 3 cascade-delete.** Той самий user-state + всі три env=0 → cron run три рази → Stage 1, Stage 2, Stage 3. На третій iteration — Business+Account+Invoice+InvoiceSlugCounter cascade-видалені для цього user-а; user-doc лишається з incomplete-profile; reminders reset до обох null. Verify: staging-БД 0 documents у відповідних колекціях для цього ownerId; login можливий, AuthGuard редіректить на /profile?mode=new.
    - **ORPHAN-4 — Cron-downtime resilience.** Симулювати multi-day-downtime: створити user-state з age=10 days + обома stamps null. Cron run першу iteration → Stage 1 fires (Stage 2/3 заблоковані prereq), не Stage 3 direct-jump. Email-trail invariant збережено. Через 2 додаткові cron-cycle — Stage 2, Stage 3. Net: cascade-deletion на +2 додаткові дні замість instant-jump, email-warnings обидва отримані.
    - **ORPHAN-5 — Multi-business email.** ФОП через repeated magic-link-claim створив 3 orphan-business-и за різні дні (наприклад, день 1: BizA, день 2: BizB, день 3: BizC; всі без firstName/lastName). На день 8 від BizA cron run → Stage 3 fires (oldestAge = 8 ≥ 7, пререкви всіх stamps; з попередніх cron-cycle-ів Stage 1 і 2 уже fired) → cascade-delete всіх 3 business-ів. Email-template на Stage 1 / 2 рендерить multi-business inline-list "«BizA», «BizB», «BizC»" з правильною UA-pluralization "3 бізнеси / 3 рахунки".

### Migrations

- 🔲 Жодного DB-migration script-а не пишемо. Production-data ще немає (`dropDatabase` + чистий старт invariant з Sprint 9). На staging — `dropDatabase` перед deploy.

---

## НЕ-скоуп

- ❌ **`pendingPostLoginTarget`-stamp і consume** — переїхали у Sprint 11.
- ❌ **`LandingClaimService.attemptLandingClaim` stamps `pendingPostLoginTarget` on success** — Sprint 11 deliverable; Sprint 12 cron сам нічого не stamps, тільки reads/clears existing stamps.
- ❌ **Cron для hard-delete soft-deleted users** — existing `CleanupService` (Sprint 1) — окрема concern, не зачіпається.
- ❌ **Soft-delete для orphan-Business з grace-period можливістю відновлення** — overengineering для MVP. Якщо user повернувся на день 9 — Business уже видалений, treats як новий signup. Якщо реальний UX-pain виявиться у telemetry — Sprint 13+ ticket.
- ❌ **Telemetry / алерти на email-failure rate, cron-execution-duration, deletion-volume** — основа observability — log-based; structured-metrics — окремий tech-backlog ticket "Sentry / Grafana spec для cron-services".
- ❌ **User-facing "Restore my data within 24h after deletion"-UX** — Sprint 13+, не блокує MVP.
- ❌ **Localization email-копії на іншу мову, крім uk** — single-locale invariant (CLAUDE.md "Single-locale (uk only)"). Якщо колись додамо locale-switching — окрема міграція.
- ❌ **Reminder-resend manual trigger з admin-panel** — admin-panel не існує у MVP. Phase 1.5+ при появі.

---

## Епіки

### 12.0 Shared types — User profileCompletionReminders

- 🔲 `packages/types/src/entities/user.ts` — додати sub-doc `profileCompletionReminders` з 2 nullable Date полів.
- 🔲 Spec round-trip serialization.
- 🔲 **Acceptance:** `pnpm --filter @finly/types build` зелений; `pnpm --filter @finly/types test` зелений.

### 12.1 Backend — cron service + UsersService methods + email infrastructure

- 🔲 `User.profileCompletionReminders` Mongoose-схема.
- 🔲 `UsersService` — 3 нові methods: `stampProfileCompletionReminder`, `resetSingleStamp`, `resetProfileCompletionReminders`. Spec на atomic-filter + prereq-guard для `'final'`.
- 🔲 `OrphanProfileCleanupService` — cron-service з aggregation pipeline + per-stage evaluator + claim-first send-flow + partial-success-resilient cascade ordering. Spec на `MongoMemoryReplSet` (6 кейсів — детально у §Скоуп.Backend cron-bullet).
- 🔲 Email infrastructure:
    - `profile-completion-reminder.tsx` + `profile-completion-final-warning.tsx` templates.
    - `email/translations.ts` `EMAIL_TEXT.profileCompletion`-section.
    - `EmailService.sendProfileCompletionReminder` + `sendProfileCompletionFinalWarning` methods.
    - Snapshot-tests на single-business і multi-business render-cases.
- 🔲 `apps/api/src/config/env.ts` — три нові env-vars з cross-field invariant. Fail-fast spec.
- 🔲 `.env.example` оновлений з коментарями.
- 🔲 `UsersModule` реєструє `OrphanProfileCleanupService` як provider.

### 12.2 Cross-cutting docs

- 🔲 `CLAUDE.md` оновлений (Domain Model + Module Dependency Map + Configuration + Known Complexities).
- 🔲 `docs/manual-checks/README.md` нові UAT-пункти ORPHAN-1..5.

---

## Risks / Known Complexities

- **Ризик 1 — Resend rate-limit на live cron-iteration.** Якщо у пікові дні буде багато orphan-users (наприклад, перші тижні після production-launch), per-iteration cron може спробувати відправити сотні емейлів одночасно. Resend має rate-limits (`100 emails/second` на free tier; вищі на paid). Mitigation: cron-iteration робить емейли послідовно через `await` у forEach-loop (одне-за-одним, не Promise.all); rate-limit ловиться як error → `resetSingleStamp` revert + log → наступний cron-cycle повторить. Tech-backlog ticket "Batch-send для Resend з explicit pacing на пікових днях".
- **Ризик 2 — Cron на standalone-Mongo dev-environment-i падає на Stage 3.** `BusinessesService.delete` cascade-flow вимагає replica-set (Sprint 4 §4.0). На standalone — `CASCADE_DELETE_REQUIRES_REPLICA_SET` → cron crash mid-iteration. Mitigation: dev-environment налаштовується через одну з трьох опцій (Atlas / Docker `--replSet rs0` / local mongod) per root README. Production Atlas — without issue. Spec-кейс перевіряє graceful-handling на standalone (cron skips Stage 3 з warn-log, продовжує наступну user-iteration).
- **Ризик 3 — Stale `firstReminderSentAt`-stamp коли email-send fail-ить ПІСЛЯ stamp-у, але ДО revert-у (наприклад, process crash між кроками).** Race-window: `stampProfileCompletionReminder` повернув `true` → `EmailService.send...` throws → ДО виклику `resetSingleStamp` — process kill (SIGTERM / OOM). Наступного дня cron бачить `firstReminderSentAt` non-null → Stage 1 не fires повторно → user не отримає reminder, проте Stage 2/3 продовжать працювати на основі цього stamp-у. Mitigation: acceptable trade-off для MVP — final-warning і deletion все одно прийдуть, лише без soft-reminder. У telemetry-driven Sprint 13+ можна додати "stamp-with-pending-send-id"-pattern (zombi-claim TTL), якщо проблема стане відчутною.
- **Ризик 4 — Backward-compat existing users без `profileCompletionReminders`-sub-doc.** Sprint 9 invariant — production-data ще немає, dropDatabase. Якщо до моменту deploy Sprint 12 у БД виявляться legacy User-документи без sub-doc (наприклад, dev-fixture не дропнутий) — Mongoose default-factory `() => ({ firstReminderSentAt: null, finalWarningSentAt: null })` спрацює тільки на write-у, не на read-у. Cron aggregation-pipeline на `$lookup` Business для read-flow може зловити `undefined` замість `null`. Mitigation: aggregation pipeline робить explicit `$ifNull`-coalesce на `profileCompletionReminders.firstReminderSentAt` і `finalWarningSentAt` → default `null`. Або, простіше — `dropDatabase` на staging перед deploy і документувати у root README "Sprint 12 deploy-prep".
- **Ризик 5 — Email-копія сприймається як спам.** Якщо user ігнорує первинне email і потім отримує "Завтра видалимо" — це може спричинити frustration ("чому ви видаляєте мої дані"). Mitigation: tone-перевірка через `tone.md` classic-polite + явне пояснення у тексті ("через незаповнений профіль", не "за неактивність") + CTA "Заповнити профіль" дає чіткий path-to-keep-data. Tech-backlog ticket "Опціональний opt-out з email-reminders для users, що свідомо вирішили abandon-нути signup" — Phase 1.5+.

---

## Definition of Done

- ✅ Усі епіки 12.0..12.2 закриті.
- ✅ `pnpm test` зелений по всіх workspace-ах:
    - `@finly/types` — `user.spec.ts` з новим `profileCompletionReminders`-sub-doc round-trip.
    - `apps/api` — `OrphanProfileCleanupService.spec.ts` 6 кейсів + `UsersService` 3 нові methods unit + EmailService 2 нові methods unit + snapshot-tests email-templates + env-cross-field-invariant fail-fast spec.
- ✅ `pnpm lint` без нових warnings.
- ✅ `pnpm build` всіх workspace-ів success.
- ✅ Smoke-test на staging:
    - Створити test-user з incomplete-profile + 1 orphan-Business зі `createdAt = now - 1 day` (через manual БД-edit або test-API). Cron-trigger вручну через staging-CLI → перевірити: reminder email отримано, БД-stamp non-null, цикл повторюваний при наступному cron-trigger через 6 днів симуляцію.
- ✅ UAT manual-checks ORPHAN-1..5 — статус ⬜ → ✅ або документований negative-result з ticket-ом.
- ✅ `CLAUDE.md` оновлений (Domain Model + Module Map + Configuration + Known Complexities).
- ✅ `.env.example` має три нові env-vars з коментарями.
- ✅ Ризик #14 з Sprint 9 (orphaned Business+Account на abandoned magic-link claim) — позначений як closed-by-design з посиланням на Sprint 12 README у Sprint 9 Risks-секції.
