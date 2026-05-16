# Sprint 12 — Планування. Q&A

> Спринт виокремлений з оригінального Sprint 9 рішенням 2026-05-11. Контекст і всі продуктові рішення зафіксовані у Q&A файлі Sprint 9: [`../09-accounts/planning-questions.md`](../09-accounts/planning-questions.md). Цей файл фіксує те, що специфічне саме для Sprint 12 (retention-policy + email-pipeline) і не покривається загальним Sprint 9 контекстом.

## Чому окремий спринт

Sprint 9 закриває core-рефакторинг Business → Business + Account і ламає Sprint 8 anon-claim flow на schema-level. Sprint 10 повертає anon-claim flow з новою архітектурою. Sprint 11 додає UX-recovery через `pendingPostLoginTarget`. Цей Sprint 12 закриває останній відкритий ризик пов'язаний з anon-claim і phone-flow без firstName/lastName — orphaned Business+Account накопичуються у БД, якщо ФОП не дозаповнив профіль після магічного посилання.

Це окрема концерн — retention-policy, не domain-refactoring і не claim-flow. Має власну архітектуру (cron + 3-stage email-pipeline + cross-field env-invariant), власний UAT (live Resend send + cron-downtime resilience simulation), і відсутність блокування на upstream-спринти на функціональному рівні (cron може бути недоступний кілька днів без зламу core-flow).

## Закриті продуктові рішення

Усі рішення для цього спринту зафіксовані як SP-13 part 2-4 у оригінальному Sprint 9 README (видалені звідти 2026-05-11 при розщепленні; повний текст збережено у git-історії і у цьому README). Ключові пункти:

### Чому 3-stage email-pipeline (а не одне нагадування або silent delete)

- **Юридичний bonus**: email-trail доводить, що user був попереджений 2 рази перед видаленням. Корисно для compliance.
- **UX**: phone-користувач міг швидко закрити таб — soft-reminder на 1-й день нагадує без urgency; final-warning на 6-й день мобілізує дію перед deletion.
- **Cron-downtime resilience через prereq-guards**: навіть якщо cron не працював 7+ днів, prereq-guards гарантують, що Stage 1 fires першим, потім Stage 2, потім Stage 3. Email-trail invariant "user попереджений 2 рази" фізично не порушується.

### Чому 1 / 6 / 7 днів як defaults

Калібрування під тон tone.md (classic-polite без urgency-spike) і retention-window (тиждень — типовий cycle phone-юзера між свідомими login-сесіями). Конкретні дні — конфігуровані через env-vars (`ORPHAN_REMINDER_FIRST_DAYS` / `_FINAL_DAYS` / `ORPHAN_CLEANUP_DELETION_DAYS`); cross-field invariant `first < final < deletion` fail-fast перевіряється на app-boot.

### Чому per-user email (не per-business)

ФОП теоретично міг створити кілька orphan-Business через repeated magic-link-claim. Stamps живуть на user-doc-у (`profileCompletionReminders`-sub-doc), тому email теж per-user. Multi-business випадок: template приймає `businesses: Business[]`-array і рендерить inline-list через кому з UA-pluralization. Anti-spam invariant зберігається — один email per user per stage per cycle.

### Чому claim-first pattern для stamping

Stage 1 / Stage 2 send-flow робить atomic `findOneAndUpdate` з conditional-filter ДО email-send. Race-protection проти "two parallel cron-instances → two emails sent". На failure email-send робить explicit revert через `resetSingleStamp`. Симетрично CLAUDE.md "AI chat durable reservation" claim-first-then-side-effect pattern.

### Чому окремий cron-service (не extension CleanupService)

`CleanupService` (`apps/api/src/modules/users/cleanup.service.ts`) має семантику hard-delete soft-deleted users після grace period — це інша concern. Mixing orphan-cleanup туди розмиє responsibility. Окремий `OrphanProfileCleanupService` поряд як sibling-pattern.

## Не вирішено / open follow-up

Жодних відкритих питань на момент створення спринту. Усі деталі покриті у Sprint 9 SP-13 discharge-list. Якщо при імплементації виявляться нові — додавати сюди.
