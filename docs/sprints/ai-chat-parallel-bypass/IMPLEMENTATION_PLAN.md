# AI Chat Parallel Bypass — Implementation Plan v3

> Технічний план виправлення TOCTOU-дефекту в AI chat flow. Базова постановка проблеми — `README.md` цього спринта. Цей документ — повний покроковий план імплементації.
>
> **Версія v3** замінює v2. Зміни v3 vs v2: (а) commit виконує **claim-first** порядок (active claim резервації перед side effects), (б) compensation для feature-specific мутацій зберігається **усередині самого reservation document** (`compensationOps`) і застосовується generically як core refund, (в) знято хибне формулювання "agency wrapper" — AI module є частиною core, а lifetime free limit є **configurable core behavior**, (г) `ExecutionTransaction.reservationId` стає **unique sparse index** як defense-in-depth idempotency.

---

## 0. Архітектурні рішення (зафіксовані)

| # | Рішення | Чому |
|---|---------|------|
| **R1** | Reservation персистується в БД як embedded subdocument `User.executions.activeReservation` з полями `id`, `amount`, `reservedAt`, `expiresAt`, `feature`, `compensationOps` | Crash-window закривається системно через cron-reconcile, а не приймається як ризик. Embedded — без додаткових колекцій. |
| **R2** | Commit виконується в **MongoDB transaction** (`session.withTransaction`). Reserve і refund — single-document atomic ops, transaction не потрібна. | Atlas — replica set, транзакції доступні. Закриває partial-failure для commit (User claim + ledger insert + feature side effects), але не вводить зайвих транзакцій там, де достатньо одного atomic update. |
| **R3** | **Compensation-in-Reservation pattern.** Reservation document зберігає список compensation `$inc` ops, які core refund застосовує атомарно разом з відновленням балансу і очищенням резервації. Cron є **повністю generic** і не знає про feature-specific поля. | Закриває проблему "cron не знає, як скомпенсувати feature-specific мутації". Уникає DI cycle "core cron → feature compensator". Generalizable: будь-який feature, що мутує власні поля під час reserve, лише декларує compensation у документі — core рефанд робить решту. |
| **R4** | **AI module — частина core.** Lifetime free limit (`ai.requestsUsed` + `AI_CHAT_FREE_LIMIT`) — це **поведінка, hardcoded coupled до AI feature**: filter, $inc, compensationOps усі перевіряють/мутують `ai.requestsUsed`. Boilerplate-клієнт, який купить core і не хоче lead-gen механіки, видаляє відповідні рядки в `AiService.reserveChatRequest` (≈5 рядків) — це задокументовано як частина AI-feature decoupling, не як env-toggle. **`AI_CHAT_FREE_LIMIT=0` НЕ є способом вимкнути cap** — з поточним filter це повністю вимикає AI чат (умова `requestsUsed < 0` завжди false). Bonus grant із `BriefService` — це існуюча sanctioned cross-module точка дотику agency→core, інфраструктура для неї вже є. | Чесно відображає реальну структуру репо (`modules/ai/` не є частиною agency-шляху за `docs/conventions/modular-boundaries.md`). Не вводить riторичного "wrapper" і не overpromis-ить env-toggle, якого немає. Якщо реальний boilerplate-клієнт колись захоче decoupling — додаємо явний `AI_CHAT_LIFETIME_CAP_ENABLED` flag у момент потреби, з реальним use case. YAGNI зараз. |
| **R5** | **Claim-first порядок у commit.** Перша операція в commit transaction — `updateOne` на User з filter `{ _id, 'executions.activeReservation.id': reservationId }` і `$set: activeReservation = null`, з обов'язковою перевіркою `matchedCount === 1`. Лише після успішного claim — ledger insert і feature side effects. | Закриває phantom-debit: stale commit (виконаний після того, як refund/cron уже закрив резервацію) бачить `matchedCount === 0`, throw, transaction rollback. Жодних side effects. |
| **R6** | **Abort policy: non-refundable after first token.** Як тільки AI-провайдер віддав перший токен, резервація committed-ється навіть на abort. Provider error після першого токена → refund (наша провина). | Anthropic списує по мірі генерації. Якщо ми вже заплатили — юзер платить. Закриває abort-bypass. |
| **R7** | **Generic core API в `UsersService`:** `commitReservation(userId, reservationId, ledgerEntry, sideEffectInTx?)` — generic, з callback для feature-specific atomic side effects; `refundReservation(userId, reservationId)` — generic, читає compensationOps з документа і застосовує. Reserve операція є **feature-specific** — кожен feature робить власний `findOneAndUpdate` з feature-specific guards/inc-ops і публікує `activeReservation` з compensationOps. | Reserve неможливо узагальнити (feature-specific guards), commit/refund — можна. Це і є справжній boilerplate value: будь-який майбутній feature (PDF gen, image gen) пише свій reserve, але переповідає core інфраструктуру для commit/refund/cron. |
| **R8** | Cron-reconciler у `UsersService`, інтервал 5 хвилин, шукає `executions.activeReservation.expiresAt < now` і викликає **той самий** generic `refundReservation`. Жодних feature-specific гілок у cron. | Generic safety net. Працює для будь-якого feature через compensationOps. |
| **R9** | `ExecutionTransaction` отримує `reservationId` поле з **unique sparse index** | Defense-in-depth: навіть якщо хтось у майбутньому порушить claim-first порядок, unique constraint спричинить duplicate key error → transaction rollback. Дві лінії захисту. |
| **R10** | Reservation TTL = 5 хвилин, hardcoded як константа в core. | Стандартний AI стрім завершується <60 секунд. 5 хвилин — комфортний buffer. |

### Цільова архітектура одним абзацом

`AiService.reserveChatRequest(userId)` робить **один атомарний** `findOneAndUpdate` на User, який одночасно: перевіряє `executions.balance >= cost`, перевіряє `ai.requestsUsed < limit + bonus`, перевіряє `executions.activeReservation === null`, декрементує balance, інкрементує requestsUsed, ставить `activeReservation = { id: uuid, amount, expiresAt, feature: 'ai_chat', compensationOps: { inc: { 'ai.requestsUsed': -1 } } }`. Це single-document operation — `atomicity` гарантована Mongo без transaction. Контролер ставить SSE headers, стрімить, на першому токені виставляє `firstTokenReceived`. На завершенні викликає `aiService.commitChatRequest(ticket, userMsg, assistantContent)`, який під капотом викликає `usersService.commitReservation(...)` з callback-ом для history insert. Core commit у transaction: claim user (matchedCount===1 або throw) → insert ledger (з reservationId, unique constraint) → виклик callback (insertMany history). На refund-шляху (provider error / client abort до першого токена) контролер викликає `aiService.refundChatRequest(ticket)` → під капотом `usersService.refundReservation(userId, reservationId)`, який атомарно: відновлює balance, застосовує `compensationOps.inc` (декремент requestsUsed), очищає activeReservation. Cron у `UsersService` кожні 5 хвилин знаходить expired reservations і викликає той самий `refundReservation`. Все.

---

## 1. Етап 0 — Звірка стану кодової бази

**Мета:** перевірити, що план відповідає актуальному коду перед будь-якими змінами.

- Прочитати у поточному стані: `apps/api/src/modules/ai/ai.controller.ts`, `ai.service.ts`, `guards/ai-rate-limit.guard.ts`, `apps/api/src/modules/users/schemas/user.schema.ts`, `execution-transaction.schema.ts`, `apps/api/src/modules/users/users.service.ts`, `packages/types/src/...` (constants, response codes), `apps/api/src/config/env.ts`.
- Знайти всі згадки `finalizeChat`, `checkAccountLimit`, `AI_LIMIT_EXHAUSTED`, `INSUFFICIENT_EXECUTIONS` у тестах і документації.
- Перевірити, чи `UsersService` уже використовує MongoDB sessions для якихось операцій (для наслідування pattern). Якщо ні — це перше використання, треба інжектнути `@InjectConnection`.
- Пересвідчитись, що `MongooseModule` у проєкті не блокує транзакції додатковими опціями.
- Перевірити, чи `ScheduleModule` уже зареєстрований (для existing `CleanupService`).

**DoD:** є точний перелік символів і файлів до зміни; жоден файл не правлений.

---

## 2. Етап 1 — Розширення доменних типів і схем

### 2.1. `User.executions` — додати `activeReservation` subdocument

У `apps/api/src/modules/users/schemas/user.schema.ts`:

- У `UserExecutions` додати поле `activeReservation` типу embedded subdocument з полями:
  - `id` — string, required (uuid v4).
  - `amount` — number, required, min 1.
  - `reservedAt` — Date, required.
  - `expiresAt` — Date, required.
  - `feature` — string, required (machine identifier; для AI: `'ai_chat'`).
  - `compensationOps` — embedded об'єкт з полем `inc: Record<string, number>` (mongoose `Schema.Types.Mixed` або типізована shape). Зберігає dotted-path-keyed `$inc` ops, які core refund застосує разом з відновленням балансу. Для AI: `{ inc: { 'ai.requestsUsed': -1 } }`.
- Дефолт усього `activeReservation` — `null`. TypeScript тип: `ActiveReservation | null`.
- Додати схема-індекс `{ 'executions.activeReservation.expiresAt': 1 }` з опцією `sparse: true` — для cron lookup.

### 2.2. `ExecutionTransaction` — додати `reservationId`

У `apps/api/src/modules/users/schemas/execution-transaction.schema.ts`:

- Додати optional поле `reservationId` (string).
- Додати `{ reservationId: 1 }` індекс з опціями `unique: true, sparse: true`. **Unique** — це defense-in-depth: будь-яка спроба дублю-вставки ledger entry для одного reservationId впаде на duplicate key, transaction rollback-неться.

### 2.3. `packages/types` — публічні константи і error codes

- Перевірити існування `RESPONSE_CODE.AI_LIMIT_EXHAUSTED` і `RESPONSE_CODE.INSUFFICIENT_EXECUTIONS` — використовувати без змін.
- Додати новий `RESPONSE_CODE.EXECUTIONS_RESERVATION_ACTIVE` (HTTP 409) — повертається, коли юзер намагається почати другу operation поки активна перша.
- Додати константу `AI_CHAT_RESERVATION_TTL_MS = 5 * 60 * 1000`.

### 2.4. Domain types — `ReservationTicket`

У `apps/api/src/modules/users/types/...` (новий файл) або поряд з `users.service.ts`:

- Експортувати TypeScript тип `ReservationTicket`:
  - `reservationId: string`
  - `userId: string`
  - `amount: number`
  - `balanceAfterReserve: number`
  - `expiresAt: Date`
  - `feature: string`
- Це in-memory структура, яку feature reserve method повертає, а контролер передає в commit/refund. Не персистується окремо — всі дані вже є в `User.executions.activeReservation`.

У `apps/api/src/modules/ai/types/...`:

- Експортувати `AiChatReservationTicket extends ReservationTicket` з додатковими полями:
  - `aiRequestsUsedAfterReserve: number`
  - `bonusGranted: boolean`
- Ці поля використовуються `commitChatRequest` для розрахунку `aiRequestsRemaining` у відповіді клієнту, без додаткового read-у.

**DoD:** схеми і типи додані, проєкт компілюється, міграція БД не потрібна (sparse поля, default null).

---

## 3. Етап 2 — Generic core API в `UsersService`

**Принцип:** ці методи є generic. Жодних згадок AI, чату, ліматів requestsUsed. Будь-який майбутній feature використовує цей же API через compensation-in-reservation.

### 3.1. `commitReservation(userId, reservationId, ledgerEntry, sideEffectInTx?, session?)`

**Параметри:**

- `userId: string`
- `reservationId: string`
- `ledgerEntry: { type, action, amount }` — поля для `ExecutionTransaction`. Сервіс додасть `userId`, `reservationId`, `balanceAfter` (fresh read з БД усередині transaction) сам. **`balanceAfter` не приймається ззовні** — це гарантує, що ledger завжди відображає актуальний баланс на момент commit-у, а не stale snapshot з ticket-а.
- `sideEffectInTx?: (session: ClientSession) => Promise<void>` — опційний callback, що виконується ВСЕРЕДИНІ тієї ж транзакції після ledger insert. Сюди feature передає свої atomic side effects (для AI — `chatMessageModel.insertMany`).
- `session?: ClientSession` — опційно. Якщо переданий — використовується чужа сесія. Якщо ні — створюється власна локальна.

**Логіка (всередині `session.withTransaction`):**

- **Крок 1 — Active claim (claim-first order):**
  - `updateOne` на User з filter `{ _id: userId, 'executions.activeReservation.id': reservationId }` і update `$set: { 'executions.activeReservation': null }`. Опція `{ session }`.
  - **Перевірити `result.matchedCount === 1`.** Якщо 0 — throw `Error('Reservation not found or already closed')`. Transaction автоматично rollback. Це **критична перевірка** — без неї stale commit створив би phantom-debit.
- **Крок 2 — Fresh balance read (конкурентно-безпечний):**
  - `findOne({ _id: userId }, { projection: { 'executions.balance': 1 }, session })`. Повертає актуальний баланс **на момент commit-у**, не snapshot з ticket-а.
  - Це критично: між reserve і commit можуть відбутися конкурентні мутації balance (Stripe webhook `addExecutions`, інші credit/debit). Snapshot `ticket.balanceAfterReserve` зафіксований у момент reserve (може бути 30+ секунд тому) і до commit-у може стати stale. Використання stale snapshot ламає інваріант audit trail: юзер побачить неможливу послідовність `balanceAfter` у ledger (наприклад, ..., 1300, 800, ...).
  - Session гарантує, що read бачить той самий snapshot, що й решта transaction.
- **Крок 3 — Ledger insert:**
  - `executionTransactionModel.create([{ ...ledgerEntry, userId, reservationId, balanceAfter: freshBalance }], { session })`. Використовує **fresh balance** з кроку 2, а не `ledgerEntry.balanceAfter`. `ledgerEntry.balanceAfter` ігнорується (або не приймається як параметр — переглянути сигнатуру у розділі параметрів вище).
  - Якщо unique sparse index по `reservationId` спричинить duplicate key error — transaction rollback. Це не очікуваний шлях за claim-first order, але defense-in-depth.
- **Крок 3 — Feature side effects:**
  - Якщо `sideEffectInTx` переданий — `await sideEffectInTx(session)`.
  - Якщо callback throw — transaction rollback (всі попередні кроки відкатуються).

**Повертає:** `{ balanceAfter: number }` — fresh balance з кроку 2, для передачі клієнту через SSE DONE. Feature може додати свої розрахунки поверх (наприклад, `aiRequestsRemaining`).

**Idempotency note:** повторний виклик `commitReservation` з тим самим `reservationId` після успіху → matchedCount буде 0 (бо `activeReservation` уже null) → throw. Це бажана поведінка: feature має знати, що подвійний commit — це bug, а не silent no-op.

### 3.2. `refundReservation(userId, reservationId)` — без транзакції

**Параметри:** `userId: string`, `reservationId: string`.

**Логіка (single atomic operation, transaction не потрібна):**

- Виконати `findOneAndUpdate` на User з filter `{ _id: userId, 'executions.activeReservation.id': reservationId }` (це теж і active claim, і ідемпотентність — якщо резервація вже закрита, filter промахнеться, повернеться null).
- Перед update треба **прочитати** `compensationOps` з документа, щоб побудувати merged `$inc`. Це робиться двофазно:
  - **Phase A — read compensationOps:** `findOne` з projection `{ executions.activeReservation: 1 }` і filter `{ _id, 'executions.activeReservation.id': reservationId }`. Якщо null → no-op return (idempotent). Це **діагностичний read**, не race-sensitive: навіть якщо між read і update інший процес встигне закрити резервацію, наш update просто промахнеться (filter перевіряє ту ж id).
  - **Phase B — atomic update з merged $inc:**
    - Побудувати `incOps = { 'executions.balance': +amount, ...compensationOps.inc }`.
    - `findOneAndUpdate` з тим же filter `{ _id, 'executions.activeReservation.id': reservationId }`, update `{ $inc: incOps, $set: { 'executions.activeReservation': null } }`.
    - Якщо повертає null — інший процес встиг закрити (idempotent no-op, return).
- НЕ пише в ledger. Reserve+refund — невидимі в audit trail.

**Idempotency:** повторний виклик з тим же reservationId → phase A повертає null → return. Жодних side effects. Безпечно для будь-якого race controller↔cron.

**Чому не транзакція:** все відбувається на одному документі через `findOneAndUpdate`. Atomicity гарантована Mongo на рівні single-document operations. Транзакція додала б overhead без додаткових гарантій.

### 3.3. `recordReservationCommit` — окремо НЕ потрібно

`recordTransaction` (existing метод) залишається існувати для **non-reservation** ledger entries (наприклад, Stripe credit). У межах reservation flow ledger пишеться лише через `commitReservation` — це гарантує, що `reservationId` завжди заповнений на debit-записах від reservation-based features.

### 3.4. Інші мутації балансу — узгодження

- Перевірити **усі** existing місця, де `executions.balance` мутується через `$inc` (Stripe webhook crediting, manual adjustments).
- Crediting (успішний Stripe payment) — додає до balance, не торкається `activeReservation`. Залишити як є.
- Debiting поза reservation (наприклад, existing `spendExecutions`) — потенційно проблемне з тим самим TOCTOU-класом. Зафіксувати в окремому backlog-тікеті (див. секція 9), **не** мігрувати в межах цього спринту.

**DoD:** два core методи (`commitReservation`, `refundReservation`) існують, generic, не знають про AI. Покриті unit-тестами в етапі 7.1.

---

## 4. Етап 3 — Cron reconciler у `UsersService`

**Мета:** safety net для зависаючих резервацій. Закриває crash-window системно. **Повністю generic** — жодних feature-specific гілок.

- Створити метод `reconcileExpiredReservations()` у `UsersService` (або новий `ExecutionsReconcileService` у тому ж модулі — обрати симетрично з existing `CleanupService`).
- Анотувати `@Cron(CronExpression.EVERY_5_MINUTES)`.
- Логіка:
  - `find` усіх юзерів з `executions.activeReservation.expiresAt: { $lt: new Date() }`. Projection: `_id` і `executions.activeReservation`. Limit на batch (100 за запуск).
  - Для кожного знайденого юзера викликати `refundReservation(user._id, user.executions.activeReservation.id)`.
  - Логувати кожен refund на рівні `warn` з полями: `userId`, `reservationId`, `feature`, `amount`, `expiredAt`, `expiredAgoMs`. Це сигнал, що **щось упало між reserve і commit/refund**.
  - try/catch навколо кожного індивідуального refund (одна помилка не зриває batch).
- Інтегрувати в `UsersModule` — переконатись, що `ScheduleModule` уже зареєстрований.

**Чому це працює generic:** `refundReservation` читає `compensationOps` з самого reservation document і застосовує їх. Cron не знає, що для AI треба декрементити `requestsUsed` — це знає сам reservation, який створив `AiService.reserveChatRequest`. Cron — лише диспетчер за TTL.

**DoD:** cron існує, покритий unit-тестом, e2e тест на reconcile (етап 7.5) проходить.

---

## 5. Етап 4 — Feature reserve в `AiService`

**Принцип:** AI module — частина core (R4). Це **не wrapper над generic core reserve**, а **feature-specific reserve operation**, яка декларує свої compensationOps для подальшого generic refund-у.

### 5.1. `reserveChatRequest(userId)` — публічний метод

**Логіка (single atomic findOneAndUpdate, без транзакції):**

- Згенерувати `reservationId = crypto.randomUUID()`.
- Розрахувати `expiresAt = new Date(Date.now() + AI_CHAT_RESERVATION_TTL_MS)`.
- Виконати `findOneAndUpdate` на User з **складним filter**, що одночасно перевіряє ВСІ умови:
  - `_id: userId`
  - `executions.balance: { $gte: AI_CHAT_COST }`
  - `executions.activeReservation: null` — single-flight guard
  - `$expr` з `$lt` на `requestsUsed < AI_CHAT_FREE_LIMIT + (bonusGranted ? AI_CHAT_BONUS_AMOUNT : 0)`, через `$ifNull` для випадку відсутнього `ai` subdocument
- Update:
  - `$inc: { 'executions.balance': -AI_CHAT_COST, 'ai.requestsUsed': 1 }`
  - `$set: { 'executions.activeReservation': { id: reservationId, amount: AI_CHAT_COST, reservedAt: now, expiresAt, feature: 'ai_chat', compensationOps: { inc: { 'ai.requestsUsed': -1 } } } }`
- Опція `{ new: true }`.
- **Якщо null** — діагностичний read (`findById` з projection `{ executions: 1, ai: 1 }`) для розрізнення причин:
  - Юзер не існує → `NotFoundException`.
  - `executions.activeReservation !== null` → `ConflictException` з `EXECUTIONS_RESERVATION_ACTIVE`.
  - `ai.requestsUsed >= limit (with bonus)` → `ForbiddenException` з `AI_LIMIT_EXHAUSTED`.
  - Інакше (балансу не вистачає) → `BadRequestException` з `INSUFFICIENT_EXECUTIONS`.
- **Якщо успіх** — побудувати `AiChatReservationTicket` з полів повернутого документа і повернути:
  - `reservationId`
  - `userId`
  - `amount: AI_CHAT_COST`
  - `balanceAfterReserve: updated.executions.balance`
  - `expiresAt`
  - `feature: 'ai_chat'`
  - `aiRequestsUsedAfterReserve: updated.ai.requestsUsed`
  - `bonusGranted: updated.ai.bonusGranted`

**Чому single op без транзакції достатньо:** все на одному документі (User), все під одним $set/$inc. Atomicity — нативна, без overhead.

### 5.2. `commitChatRequest(ticket, userMessage, assistantContent)` — публічний метод

**Логіка:**

- Викликати `usersService.commitReservation(...)` з параметрами:
  - `userId: ticket.userId`
  - `reservationId: ticket.reservationId`
  - `ledgerEntry: { type: DEBIT, action: AI_CHAT, amount: ticket.amount }` — **без `balanceAfter`** (core commit прочитає fresh balance з БД усередині transaction, щоб не ламати audit trail при конкурентних mutations, які виконуються між reserve і commit)
  - `sideEffectInTx: async (session) => { await chatMessageModel.insertMany([userMsg, assistantMsg], { session, ordered: true }) }`
- `commitReservation` повертає `{ balanceAfter: number }` — fresh з БД, а не зі stale ticket snapshot.
- Якщо `commitReservation` throw — пробросити exception назовні. Контролер у `finally` викличе refund.
- На успіх — розрахувати:
  - `balanceAfter: commitResult.balanceAfter` (**fresh з commit**, не з ticket-а)
  - `aiRequestsRemaining: max(0, AI_CHAT_FREE_LIMIT + (ticket.bonusGranted ? AI_CHAT_BONUS_AMOUNT : 0) - ticket.aiRequestsUsedAfterReserve)`
- Повернути `{ balanceAfter, aiRequestsRemaining }`.

**Зауваження:** AI-specific логіка — це лише (а) формування ledger action, (б) формування history insertMany callback, (в) розрахунок remaining. Уся транзакційна машинерія, claim-first порядок, fresh balance read, idempotency — у core `commitReservation`.

### 5.3. `refundChatRequest(ticket)` — тонка делегація

**Логіка:**

- `await usersService.refundReservation(ticket.userId, ticket.reservationId)`.
- Catch будь-якої помилки внутрішньо: `logger.error` з `reservationId`, `userId`, error message. **Не пробрасувати** — це останній shield, після нього лише cron підхопить через TTL.

**Чому це wrapper, а не прямий виклик `usersService.refundReservation` із controller:** тримає controller dependency-tight на `AiService` only (один injectable замість двох). Symmetry з reserve/commit. Marginal cleanup.

### 5.4. Видалення `finalizeChat`

- Видалити метод повністю з `ai.service.ts`.
- Перевірити, що жоден файл (поза тестами) на нього не посилається.

**DoD:** три AI service методи існують, старий `finalizeChat` видалений, проєкт компілюється.

---

## 6. Етап 5 — Перебудова `AiRateLimitGuard` і `AiController`

### 6.1. `AiRateLimitGuard` — чистка

- Видалити приватний метод `checkAccountLimit` і його виклик з `canActivate`.
- Видалити імпорти, які стали зайвими (`RESPONSE_CODE.AI_LIMIT_EXHAUSTED`, `ENV.AI_CHAT_FREE_LIMIT`, `ENV.AI_CHAT_BONUS_AMOUNT`).
- Залишити `checkIpLimit` без змін.
- Оновити docstring класу: явно зазначити, що guard перевіряє лише IP rate limit; account-ліміт перенесений в `AiService.reserveChatRequest`.

### 6.2. `AiController.chat` — повна перебудова

**Pre-stream phase (без SSE):**

- Видалити старий pre-stream balance check.
- Викликати `const reservation = await this.aiService.reserveChatRequest(userId)`. Будь-який exception (4xx) пробросити — Nest exception filter відрендерить HTTP error. SSE headers ще не встановлені.

**SSE bootstrap:**

- Встановити SSE headers, `flushHeaders`.
- Завести три локальні прапорці: `firstTokenReceived = false`, `committed = false`, `aborted = false`.
- Налаштувати `AbortController` і `req.on('close', onClose)`.

**Stream phase у `try`:**

- Викликати `processChat` зі signal.
- Цикл по chunks з `for await`:
  - Якщо `aborted === true` → break.
  - Якщо `firstTokenReceived === false` → виставити в true. Це **точка переходу** від refundable до non-refundable.
  - Накопичувати `assistantContent`, write SSE TOKEN event.
- Після циклу:
  - Якщо `!aborted` → `await commitChatRequest(reservation, ...)`. На успіх — `committed = true`. Write SSE DONE з `balanceAfter` і `aiRequestsRemaining`.
  - Якщо `aborted && firstTokenReceived` → **non-refundable**. `await commitChatRequest(reservation, dto.message, assistantContent)` (з частковим контентом). На успіх — `committed = true`. SSE DONE НЕ відправляємо (з'єднання закрите).
  - Якщо `aborted && !firstTokenReceived` → нічого не робимо. `committed` залишається false. Refund спрацює у finally.

**`catch (err)`:**

- Логувати `error` з `userId`, `reservationId`, error message.
- **Особлива гілка:** якщо `aborted && firstTokenReceived` потрапив у catch (наприклад, abort signal спричинив throw з provider-у) — викликати `commitChatRequest` тут же (non-refundable). Якщо commit вдався — `committed = true`. Якщо commit упав — залишити `committed = false`, refund спрацює у finally.
- Якщо `firstTokenReceived === false` → provider error до стріму. `committed = false` → finally refund.
- Якщо `firstTokenReceived === true && !aborted` → provider error посеред стріму. **Refund** (наша/Anthropic-ова провина). `committed = false` → finally refund.
- SSE ERROR event відправити лише якщо `!aborted`.

**`finally`:**

- `req.off('close', onClose)`.
- Якщо `committed === false` → `await refundChatRequest(reservation)` усередині локального try/catch (внутрішній — лише defensive, бо сам `refundChatRequest` уже catch-ить).
- Якщо `!res.writableEnded` → `res.end()`.

**Матриця exit-стежок:**

| Сценарій | firstToken | aborted | committed (final) | refund? | SSE last |
|----------|------------|---------|-------------------|---------|----------|
| Happy path | true | false | true | no | DONE |
| Reserve fail (4xx) | — | — | — | — | HTTP error, no SSE |
| Provider error до 1-го токена | false | false | false | yes | ERROR |
| Provider error після 1-го токена | true | false | false | yes | ERROR |
| Client abort до 1-го токена | false | true | false | yes | (none) |
| Client abort після 1-го токена | true | true | true | no | (none) |
| Commit падає (Mongo) | true | false | false | yes | ERROR |
| Refund сам падає | * | * | false | logged | ERROR/none |

Перевіряти як test matrix у controller тестах (етап 7.4).

**DoD:** controller відповідає матриці exit-стежок; покритий тестами 8.4.

---

## 7. Етап 6 — Frontend (error contract + warning UX)

**Мета:** замкнути system contract для нового error code `EXECUTIONS_RESERVATION_ACTIVE` і додати UX warning про non-refundable abort policy. Без цього кроку backend кидає 409, frontend бачить невідомий код, юзер отримує generic fallback toast — порушення i18n конвенції з `docs/conventions/i18n.md`.

### 7.1. Public error code

- У `packages/types/src/contracts/responses/...` (або де визначений `RESPONSE_CODE` map) додати `EXECUTIONS_RESERVATION_ACTIVE`.
- У `RESPONSE_CODE_TYPE` map (де класифікуються коди як `SUCCESS` vs `ERROR`) — позначити новий код як `ERROR`.
- Перебудувати `@cyanship/types` (`pnpm --filter @cyanship/types build`) перед тим, як стартувати frontend зміни.

### 7.2. Backend i18n module routing

- `EXECUTIONS_RESERVATION_ACTIVE` — це **users-module** error (бо генерується core `UsersService` reservation infrastructure через AI service), тому в frontend він мапиться як `errors.users.executions_reservation_active`. Контролер AI чату вже має відповідне per-error fallback логіку (див. `apps/web/src/app/[locale]/(protected)/ai-chat/page.tsx:217-221` — `getApiMessageKey(err.code, 'users')` для users-codes). Перевірити, що exception з `AiService.reserveChatRequest` повертає код у форматі, який frontend route-ить на `'users'` модуль.
- Якщо існуюча логіка route-ить новий код на `'ai'` модуль (бо приходить з `/ai/chat` ендпоінта) — додати i18n ключ в обох неймспейсах: `errors.users.executions_reservation_active` і `errors.ai.executions_reservation_active`. Це дешеве рішення без необхідності міняти frontend mapping logic.

### 7.3. i18n keys (uk + en)

- У `apps/web/messages/uk.json` додати під `errors.users` (поряд з existing `insufficient_executions`):
  - Ключ `executions_reservation_active`
  - Текст українською: "Попередній запит ще обробляється. Зачекайте кілька секунд і спробуйте знову."
- У `apps/web/messages/en.json` додати дзеркальний ключ:
  - "A previous request is still being processed. Wait a few seconds and try again."
- Дотримуватись tone з `docs/conventions/tone.md` (нейтральний, без "Помилка:" префіксу, без emoji).

### 7.4. Перевірка mapApiCode

- `apps/web/src/shared/api/mapApiCode.ts` уже generic (мапить будь-який code через lower-case + module). Жодних змін у самому файлі НЕ потрібно — він автоматично знайде новий ключ.
- Sanity-перевірити, що `tGlobal(getApiMessageKey('EXECUTIONS_RESERVATION_ACTIVE', 'users'))` повертає очікуваний string у unit-тесті (можна додати один кейс у existing `mapApiCode.test.ts` якщо існує; якщо ні — пропустити).

### 7.5. AI chat UI handling

- У `apps/web/src/app/[locale]/(protected)/ai-chat/page.tsx` (приблизно lines 213-221, де existing error toasts) перевірити, що 409 з кодом `EXECUTIONS_RESERVATION_ACTIVE` потрапляє в одну з гілок `getApiMessageKey(err.code, 'users')` або (`'ai'`). Якщо потрапляє — toast з'являється автоматично через існуючий код.
- Якщо вимагається спеціальне UX поведінка (наприклад, disable submit button на 3 секунди після цієї помилки замість простого toast) — це nice-to-have, **не блокатор**. Базовий toast достатній для коректності контракту.

### 7.6. Non-refundable abort warning

- У тому ж `ai-chat/page.tsx` (або у дочірньому компоненті, що містить input + send button) додати інлайн-підказку поряд з input полем (плейсхолдер, helper-text, або footer chat-area):
  - Текст: "Якщо AI почав відповідати, кошти не повертаються при перериванні."
- Локалізувати через next-intl. Додати новий ключ під `ai-chat.warnings.non_refundable_after_first_token` (або симетрично з existing namespace) у `uk.json` і `en.json`.
- Це **інлайн helper-text**, а не модальне вікно. Юзер бачить його перед першим повідомленням, не перебиває flow.

### 7.7. Не міняємо

- SSE event-handling код (`TOKEN`/`DONE`/`ERROR` парсинг). Контракт залишається.
- HTTP error handling шлях (`getApiMessageKey` → `tGlobal` → `toast.error`). Лише додаємо новий i18n ключ і refреshуємо `@cyanship/types`.

**DoD:**
- [ ] `EXECUTIONS_RESERVATION_ACTIVE` додано в `RESPONSE_CODE` і `RESPONSE_CODE_TYPE` у `@cyanship/types`.
- [ ] i18n ключі для нового коду додано в `uk.json` і `en.json` (тон-конвенція дотримана).
- [ ] Manual smoke test: forced 409 (через MongoDB hand-edit активної reservation) показує юзеру локалізований toast, не generic fallback.
- [ ] Inline non-refundable warning видимий юзеру біля input.
- [ ] Локалізації для warning додано в обидва мовні файли.

---

## 8. Етап 7 — Тести

### 8.1. Unit-тести `UsersService` core методів

Замокати: `userModel`, `executionTransactionModel`, `connection`/`session`. Helper для emulating session callback.

**`commitReservation`:**

- **Claim-first ordering test:** mock `userModel.updateOne` → matchedCount=1; mock findOne (fresh balance) → `{ executions: { balance: 500 } }`; mock ledger create OK; mock callback OK. Перевірити: updateOne (claim) викликаний ПЕРШИМ, потім findOne (balance read), потім ledger create з `balanceAfter: 500` (fresh, не з ticket-а), потім callback.
- **Fresh balance read test:** mock claim OK; mock findOne → balance=1300 (відрізняється від ticket.balanceAfterReserve=800, бо конкурентний credit між reserve і commit). Перевірити: ledger entry містить `balanceAfter: 1300`, а не 800. Повернутий `{ balanceAfter }` = 1300.
- **Stale commit (claim fails) test:** mock `userModel.updateOne` → matchedCount=0. Перевірити: метод throw, balance read НЕ викликаний, ledger create НЕ викликаний, callback НЕ викликаний.
- **Ledger insert fails test:** mock claim OK, mock balance read OK, mock ledger create throw → транзакція rollback (через mock session.abortTransaction). Метод пробрасує exception.
- **Side effect callback fails test:** mock claim OK, balance read OK, ledger OK, callback throw → транзакція rollback. Метод пробрасує.
- **Idempotency test:** повторний виклик з тим самим reservationId → matchedCount=0 → throw (бажана поведінка, не silent no-op).
- **No callback test:** sideEffectInTx=undefined → метод відпрацьовує без виклику callback, claim+balance read+ledger виконані.
- **Session reuse test:** якщо session передана — не створювати власну, використати чужу. Всі ops (claim, findOne, ledger, callback) отримують ту ж session.

**`refundReservation`:**

- Active reservation існує → читає compensationOps → виконує merged $inc (balance + compensation) → очищає reservation. Перевірити структуру update.
- compensationOps.inc порожній → лише balance refund.
- compensationOps.inc з кількома полями → всі застосовані в одному $inc.
- Reservation вже null (idempotent no-op) → метод return без update.
- Reservation з іншим id → метод return без update (чужа резервація, не зачіпаємо).
- НЕ пише в ledger.
- НЕ використовує транзакцію (assert на session.startSession НЕ викликаний).

### 8.2. Unit-тести cron reconciler

- Знаходить юзерів з expired reservations → викликає refundReservation для кожного.
- Не зачіпає юзерів з активними (non-expired) reservations.
- Не зачіпає юзерів без reservation.
- Limit на batch.
- Помилка refund на одному юзері не зриває batch.
- Логує кожен refund на рівні `warn` з усіма полями.

### 8.3. Unit-тести `AiService`

Замокати: `usersService`, `chatMessageModel`, `userModel`, `AI_PROVIDER`.

**`reserveChatRequest`:**

- Достатньо лімітів і балансу → `findOneAndUpdate` повертає updated document → ticket повернутий з усіма полями.
- Filter містить `executions.activeReservation: null`, `balance: $gte`, `$expr` для requestsUsed.
- Update встановлює `compensationOps.inc['ai.requestsUsed'] === -1`.
- Балансу не вистачає (mock null + diagnostic read) → `BadRequestException` з `INSUFFICIENT_EXECUTIONS`.
- Lifetime ліміт вичерпано → `ForbiddenException` з `AI_LIMIT_EXHAUSTED`.
- Active reservation існує → `ConflictException` з `EXECUTIONS_RESERVATION_ACTIVE`.
- Юзер не існує → `NotFoundException`.
- Bonus враховується (juzер з `bonusGranted=true` і `requestsUsed=AI_CHAT_FREE_LIMIT` — успіх).
- `ai` subdocument null → працює через `$ifNull`.
- `reservationId` — uuid v4 (regex assert), `expiresAt ≈ now + TTL`.
- НЕ використовує транзакцію.

**`commitChatRequest`:**

- Викликає `usersService.commitReservation` з: `userId, reservationId` з ticket; `ledgerEntry.action === AI_CHAT`; `sideEffectInTx` — функція, що викликає `chatMessageModel.insertMany` з парою повідомлень.
- Розраховує `aiRequestsRemaining` коректно (з і без bonus).
- Якщо `commitReservation` throw — exception пробрасується.

**`refundChatRequest`:**

- Викликає `usersService.refundReservation(userId, reservationId)`.
- Не пробрасує exception назовні (catch + log).
- Idempotent: повторний виклик безпечний (тестується через mock що повертає no-op).

### 8.4. Unit-тести `AiController`

Mock factory для `req`/`res` (Express SSE-сумісний). Mock `AiService`.

- **Happy path:** reserve→ticket; stream→3 chunks; commit→result. Asserts: 3 TOKEN writes, 1 DONE write, commit викликаний, refund НЕ викликаний.
- **Reserve fails (4xx):** controller пробрасує, `flushHeaders` НЕ викликаний.
- **Provider error до 1-го токена:** stream throw перед першим chunk → catch → ERROR write → refund викликаний.
- **Provider error після 1-го токена:** stream throw на 2-му chunk → catch → ERROR write → refund викликаний.
- **Client abort до 1-го токена:** emulate `req.emit('close')` перед першим chunk → loop break → committed=false → refund викликаний → DONE НЕ відправлений.
- **Client abort після 1-го токена:** emulate close після першого chunk → loop break → commit викликаний (non-refundable) → committed=true → refund НЕ викликаний.
- **Commit падає:** stream OK, commit throw → catch → refund викликаний.
- **Refund сам падає:** stream OK, commit throw, refund (через AiService) теж throw — але AiService.refundChatRequest catch-ить внутрішньо → controller finally не падає, `res.end` викликаний.

### 8.5. E2E тести (`apps/api/test/ai.e2e-spec.ts` — новий файл)

**Setup:**

- Підняти `AppModule` з **MongoMemoryReplSet** (replica set, не звичайний MemoryServer — необхідно для transactions).
- Override `AI_PROVIDER` на mock provider, що повертає `Readable.from(['chunk1', 'chunk2'])` зі штучним `await sleep(100ms)` ПЕРЕД першим chunk (для конкурентності).
- Override `REDIS_CLIENT` на ioredis-mock.

**Тести:**

- **Race на баланс:** юзер з `balance = AI_CHAT_COST`, `requestsUsed = 0`. 5 паралельних запитів. Очікування: рівно 1 → 200 з SSE DONE; 4 → HTTP 400 (`INSUFFICIENT_EXECUTIONS`) АБО 409 (`EXECUTIONS_RESERVATION_ACTIVE`). Після завершення: `balance === 0`, `requestsUsed === 1`, `activeReservation === null`. Ledger: 1 запис з `reservationId`. History: 2 повідомлення.
- **Race на ліміт:** `balance >> cost`, `requestsUsed = AI_CHAT_FREE_LIMIT - 1`. 5 паралельних. Очікування: 1 → DONE; 4 → 403 (`AI_LIMIT_EXHAUSTED`) АБО 409.
- **Sanity single request:** один запит → DONE, ledger, history.
- **Refund на abort до 1-го токена:** abort через `request.abort()` ДО першого chunk. Перевірити: `balance` повернувся, `requestsUsed` повернувся (через compensationOps), ledger порожній, history порожній, `activeReservation === null`.
- **Non-refundable abort після 1-го токена:** mock provider віддає 1-й chunk одразу, потім `sleep(500ms)` перед 2-м. Юзер abort-ить через 100ms. Очікування: `balance === initial - cost`, `requestsUsed === initial + 1`, ledger має 1 запис, history має 2 повідомлення (з частковим assistantContent).
- **Cron reconcile:** створити юзера з `activeReservation` і `expiresAt` у минулому, з compensationOps `{ inc: { 'ai.requestsUsed': -1 } }` і попередньо інкрементованим `requestsUsed`. Викликати `reconcileExpiredReservations()` напряму. Перевірити: `activeReservation === null`, `balance` повернутий, `requestsUsed` декрементований (доказ, що cron generic compensation працює).
- **Stale commit detection:** створити юзера, зробити reserve, видалити `activeReservation` руками з БД (симулюючи refund/cron між reserve і commit). Викликати commit → перевірити, що ledger entry **НЕ** створюється і метод throw.
- **Double refund safety:** reserve, потім викликати refundChatRequest двічі поспіль. Перевірити, що `requestsUsed` декрементований **рівно один раз**, balance відновлений рівно один раз.

**Детермінізм:** для race-тестів критично, щоб mock provider мав sleep ПЕРЕД першим chunk. Перевірка: `git stash` AI service змін → race-тести мають впасти на старому коді. Stale commit і double refund тести мають впасти на v2-плані без claim-first / без compensation-in-reservation.

**DoD:** усі тести зелені на новому коді; race/stale-commit/double-refund тести червоні на старому.

---

## 9. Етап 8 — Документація

- **`CLAUDE.md`** — секція "AI chat streaming" і "Known Complexities":
  - Замінити "AI chat debit only on success" на: "AI chat: durable reserve → stream → commit/refund. Reserve — single atomic findOneAndUpdate (без транзакції). Commit — Mongo transaction з claim-first порядком (active claim резервації перед side effects). Refund — single atomic findOneAndUpdate, що застосовує `compensationOps` зі збереженого reservation document. Cron у `UsersService` — generic safety net через ту саму `refundReservation`."
  - Перефразувати "3-layer protection": тепер 2 шари — IP rate limit (Redis Lua) і atomic durable reservation (single-document Mongo op, поєднує account limit + balance + reservation guard в одній операції).
  - Додати: "AI chat abort policy: refundable до першого токена, non-refundable після. Юзер сповіщений у UI."
  - Додати: "Reservation primitives (`UsersService.commitReservation`, `refundReservation`, cron-reconciler) — generic core API. Будь-який feature, що мутує власні поля під час reserve, декларує compensation у `activeReservation.compensationOps`; core refund застосовує їх атомарно. Це — primary boilerplate value цього патерну."
- **`docs/sprints/ai-chat/`** — оновити будь-які згадки старого flow.
- **`docs/sprints/ai-chat-parallel-bypass/README.md`** — додати в кінці секцію "Implementation outcome" з посиланням на цей файл, статусом, посиланнями на PR і e2e тести.
- **Створити окремий backlog тікет:** "Migrate `UsersService.spendExecutions` (and other balance-debiting paths) to reservation primitives". Опис: same TOCTOU class у меншому масштабі, треба використати reservation pattern з відповідним `feature` ідентифікатором.
- **`docs/conventions/`** — опційно: додати короткий note про reservation pattern як convention для будь-яких майбутніх usage-based features.

**DoD:** документація узгоджена, backlog-тікет створений.

---

## 10. Етап 9 — Фінальна верифікація

- Локальний цикл:
  - `pnpm --filter @cyanship/types build`
  - `pnpm --filter api build`
  - `pnpm --filter api lint`
  - `pnpm --filter api test`
  - `pnpm --filter api test:e2e`
  - `pnpm --filter web build`
  - `pnpm --filter web test`
- **Manual smoke test:**
  - Один запит → DONE, баланс і remaining коректні, ledger entry і history pair, `activeReservation === null`.
  - Два паралельних з низьким балансом → один проходить, другий 4xx без SSE.
  - Abort до першого токена → balance і requestsUsed повернуті.
  - Abort після першого токена → списано як committed.
  - Виставити `activeReservation` руками з `expiresAt` у минулому → дочекатись cron tick → reservation очищена, balance і requestsUsed повернуті (доказ generic compensation).
- **Логи:** на refund-шляхах — запис з `reservationId`. На cron-reconcile — `warn` з усіма полями. На refund-failure — `error`.
- **DoD checklist:**
  - [ ] Account-ліміт видалений з guard.
  - [ ] Generic core API в `UsersService`: `commitReservation`, `refundReservation`.
  - [ ] Claim-first порядок у `commitReservation` з обов'язковою перевіркою matchedCount.
  - [ ] Compensation-in-reservation pattern: `activeReservation.compensationOps` зберігається при reserve, застосовується generically при refund.
  - [ ] Feature-specific reserve у `AiService`: 3 публічні методи (reserve, commit, refund — останні два thin delegations поверх core).
  - [ ] Старий `finalizeChat` видалений.
  - [ ] Controller відповідає матриці exit-стежок (включно з non-refundable after first token).
  - [ ] Cron reconciler у `UsersService` працює, generic, покритий тестом.
  - [ ] `User.executions.activeReservation` додано в схему з sparse index по `expiresAt` і полем `compensationOps`.
  - [ ] `ExecutionTransaction.reservationId` додано з **unique sparse** index.
  - [ ] Mongo transaction використовується для commit (User claim + ledger insert + side effect callback).
  - [ ] Reserve і refund — single-document atomic ops без транзакцій.
  - [ ] Frontend warning про non-refundable abort додано і локалізовано.
  - [ ] `EXECUTIONS_RESERVATION_ACTIVE` додано в `@cyanship/types` (`RESPONSE_CODE` + `RESPONSE_CODE_TYPE`).
  - [ ] i18n ключі для `EXECUTIONS_RESERVATION_ACTIVE` додано в `uk.json` і `en.json`.
  - [ ] README.md спринта scope-нутий до problem statement only, з pointer на `IMPLEMENTATION_PLAN.md` як authoritative.
  - [ ] Усі unit-тести зелені.
  - [ ] E2E тести зелені, включно з: race на баланс, race на ліміт, abort до/після 1-го токена, cron reconcile (compensation працює), stale commit detection, double refund safety.
  - [ ] Race / stale-commit / double-refund тести падають на старому коді.
  - [ ] CLAUDE.md і sprint docs оновлені.
  - [ ] Backlog-тікет на міграцію `spendExecutions` створений.

---

## 11. Що цей план закриває з зауважень критика

| Issue | Закрито через |
|-------|---------------|
| **#1 — commit не прив'язаний до живої резервації (phantom-debit)** | **Claim-first порядок** у `commitReservation` (R5): перша операція в транзакції — active claim з `matchedCount === 1` обов'язковою перевіркою. Stale commit падає до будь-яких side effects. **Defense-in-depth:** unique sparse index на `ExecutionTransaction.reservationId` (R9) — навіть при майбутньому регресі порядку, duplicate key error викличе rollback. |
| **#2 — refund не ідемпотентний у agency wrapper (подвійний decrement)** | **Compensation-in-reservation** (R3): compensation `$inc` зберігається в reservation document і застосовується атомарно як частина core refund в одному `findOneAndUpdate`. Подвійний виклик refund → перший очищає reservation і застосовує compensation; другий бачить null reservation → no-op. AI service більше не має окремої post-core decrementу — нічого декрементити, бо compensation вже вкладена в core refund. |
| **#3 — cron не знає feature-specific compensation (incomplete crash-window closure)** | **Compensation-in-reservation** (R3) робить cron повністю generic: він не знає про `ai.requestsUsed`, він викликає `refundReservation`, який читає `compensationOps` з документа і застосовує їх. Жодних feature-specific гілок у cron. Жодного DI cycle. |
| **Open question — `modules/ai` vs agency path** | Чесно зафіксовано (R4): AI module є частиною core. Lifetime free limit — це **configurable core behavior** через `AI_CHAT_FREE_LIMIT`, не agency-specific річ. Bonus grant із `BriefService` — це існуюча sanctioned cross-module точка, інфраструктура для неї вже працює. Не вводимо неіснуючого "wrapper" риторично. |

Plus boilerplate value:

- **Reservation primitives як patten** — будь-який майбутній usage-based feature (PDF gen, image gen, video processing) пише свій feature-specific reserve, а commit/refund/cron отримує безкоштовно з core.
- Backlog-тікет на міграцію `spendExecutions` гарантує, що той самий patten покриє всі debit-точки балансу.

---

## 12. Out of scope (явно)

- Міграція `UsersService.spendExecutions` (та інших debit-шляхів) на reservation primitives — окремий backlog тікет.
- Метрики/alerting на cron-reconcile findings.
- Зміни IP rate limit логіки.
- Зміна цін чи лімітів.
- Multi-active-reservation per user (зараз обмежено single-flight через `activeReservation: null` guard).
- Generalization compensationOps за межі `$inc` (наприклад, `$set` або conditional compensation) — додамо, коли з'явиться реальний feature, що цього потребує.
