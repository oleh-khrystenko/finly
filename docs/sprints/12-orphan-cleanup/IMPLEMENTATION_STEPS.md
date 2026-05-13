# Sprint 12 — Implementation Steps (live tracker)

> Робочий чек-лист на час імплементації. Після `Definition of Done` файл можна видалити.
> Кожен крок = окремий commit. Між кроками downstream-build може бути broken (acceptable per project convention).
> Епік 12.1 розщеплено на 3 під-кроки за file-count і логічними кордонами: env+schema+stamps → email-infra → cron.

---

## Step 1 — Епік 12.0 (Shared types)

- [ ] `packages/types/src/entities/user.ts` — додати `profileCompletionReminders` sub-doc (`z.object({ firstReminderSentAt: z.date().nullable(), finalWarningSentAt: z.date().nullable() }).default({ firstReminderSentAt: null, finalWarningSentAt: null })`).
- [ ] `packages/types/src/entities/user.spec.ts` (або existing) — round-trip serialization з default-shape + non-null state-shape.
- [ ] **Acceptance:** `pnpm --filter @finly/types build && pnpm --filter @finly/types test` зелений.
- [ ] **Commit:** `feat: add profileCompletionReminders to User entity (Sprint 12.0)`

---

## Step 2 — Епік 12.1a (Backend — env, Mongoose schema, UsersService stamps)

- [ ] `apps/api/src/config/env.ts` — додати `ORPHAN_REMINDER_FIRST_DAYS` (default 1), `ORPHAN_REMINDER_FINAL_DAYS` (default 6), `ORPHAN_CLEANUP_DELETION_DAYS` (default 7); cross-field invariant `first < final < deletion` (fail-fast).
- [ ] `apps/api/src/config/env.spec.ts` (або existing fail-fast spec) — кейс на violated invariant.
- [ ] `.env.example` — додати три нові env-vars з коментарями.
- [ ] `apps/api/src/modules/users/schemas/user.schema.ts` — `@Prop` `profileCompletionReminders` sub-doc з factory-default обох-null.
- [ ] `apps/api/src/modules/users/users.service.ts` — `stampProfileCompletionReminder(userId, stage)` (atomic claim з conditional-filter; prereq-guard для `'final'`).
- [ ] `apps/api/src/modules/users/users.service.ts` — `resetSingleStamp(userId, stage)` (non-conditional revert на email-failure).
- [ ] `apps/api/src/modules/users/users.service.ts` — `resetProfileCompletionReminders(userId)` (full clear після Stage-3 full-success).
- [ ] `apps/api/src/modules/users/users.service.spec.ts` — unit-кейси: stamp first (success), stamp first idempotent skip, stamp final без prereq (skip), stamp final з prereq (success), reset single, reset full.
- [ ] **Acceptance:** `pnpm --filter api test` зелений.
- [ ] **Commit:** `feat: add profileCompletionReminders schema and UsersService stamps (Sprint 12.1a)`

---

## Step 3 — Епік 12.1b (Backend — email templates, translations, EmailService methods)

- [ ] `apps/api/src/modules/email/translations.ts` — створити (якщо не існує) або розширити секцією `EMAIL_TEXT.profileCompletion` з `reminder.{singleSubject,multiSubject,singleBody,multiBody,cta}` + `finalWarning.{...}`. Single-locale uk, direct strings.
- [ ] `apps/api/src/modules/email/templates/profile-completion-reminder.tsx` — Stage 1 soft-tone (classic-polite per tone.md, без `!`); props `{ businesses: Array<{ name: string }> }`; UA-pluralization через `Intl.PluralRules('uk-UA')`; CTA `/profile?mode=new&next=/business`.
- [ ] `apps/api/src/modules/email/templates/profile-completion-final-warning.tsx` — Stage 2 urgent-через-формулювання; той самий props-shape і CTA.
- [ ] `apps/api/src/modules/email/email.service.ts` — `sendProfileCompletionReminder({ user, businesses })` (Resend call, prop-mapping мінімізує до name-only).
- [ ] `apps/api/src/modules/email/email.service.ts` — `sendProfileCompletionFinalWarning({ user, businesses })` (symmetric).
- [ ] Snapshot-spec template render на single-business і multi-business кейси (`>=2` для UA-pluralization).
- [ ] **Acceptance:** `pnpm --filter api test` зелений.
- [ ] **Commit:** `feat: add profile-completion email templates and service methods (Sprint 12.1b)`

---

## Step 4 — Епік 12.1c (Backend — cron service + module wiring)

- [ ] `apps/api/src/modules/users/orphan-profile-cleanup.service.ts` — новий cron-service з `@Cron('0 5 * * *', { timeZone: 'Europe/Kyiv' })`.
- [ ] Aggregation pipeline на `User`: `$match` incomplete-profile → `$lookup` Business by `ownerId` → `$match orphanBusinesses.length ≥ 1` → `$addFields oldestBusinessAge` (з `$ifNull` coalesce на reminder-stamps).
- [ ] Per-user evaluator: Stage 3 > Stage 2 > Stage 1 (single fire per cycle); prereq-guards inline у threshold-rules.
- [ ] Stage 1/2: claim-first → on-success send → on-failure `resetSingleStamp` + log; sequential `await` у forEach (Resend rate-limit mitigation).
- [ ] Stage 3: окремий sorted-by-createdAt query → forEach `BusinessesService.delete` → break on failure → final `countDocuments` → reset reminders + `clearPendingPostLoginTarget` ТІЛЬКИ на `===0`.
- [ ] `apps/api/src/modules/users/users.module.ts` — реєстр `OrphanProfileCleanupService` як provider; додати `EmailModule` / `BusinessesModule` у `imports` за потреби.
- [ ] `apps/api/src/modules/users/orphan-profile-cleanup.service.spec.ts` — на `MongoMemoryReplSet`, 6 кейсів:
    1. Stage 1 fires (age=1, обидва stamps null).
    2. Stage 2 fires (age=6, firstReminderSentAt set, finalWarningSentAt null).
    3. Stage 3 fires (age=7, обидва stamps set; cascade-delete success → reset).
    4. Post-downtime resilience: age=10 + обидва stamps null → ТІЛЬКИ Stage 1 fires (не jump до Stage 3).
    5. Stage 3 partial-cascade failure (наприклад, mock `BusinessesService.delete` throws на 2-му з 3 business-ів) → reminders НЕ reset.
    6. Email-send failure → `resetSingleStamp` revert.
- [ ] **Acceptance:** `pnpm --filter api test` зелений.
- [ ] **Commit:** `feat: add OrphanProfileCleanupService cron (Sprint 12.1c)`

---

## Step 5 — Епік 12.2 (Cross-cutting docs)

- [ ] `docs/manual-checks/README.md` — додати UAT-пункти ORPHAN-1..5 (зміст у §Скоуп.Cross-cutting README).
- [ ] **`CLAUDE.md`** — Domain Model `User` додати `profileCompletionReminders`; Module Map — `OrphanProfileCleanupService` як cron у `UsersModule`; Configuration — три нові env-vars + cross-field invariant; Known Complexities — новий пункт про 3-stage email-pipeline + prereq-guards для cron-downtime resilience. **Це робить користувач сам** (skill не редагує `CLAUDE.md`).
- [ ] **Acceptance:** `pnpm lint && pnpm build` зелений.
- [ ] **Commit (manual-checks частина):** `docs: add Sprint 12 UAT entries (Sprint 12.2)`

---

## Final verification

- [ ] `pnpm test` зелений по всіх workspace-ах.
- [ ] `pnpm lint` без нових warnings.
- [ ] `pnpm build` всіх workspace-ів success.
- [ ] DoD у README.md відмічено.
- [ ] Цей файл (`IMPLEMENTATION_STEPS.md`) видалено.
