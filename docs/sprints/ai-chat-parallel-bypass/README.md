# AI Chat — Parallel Request Bypass (TOCTOU)

> **Authoritative implementation plan:** [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) (v3, durable reservation + claim-first commit + compensation-in-reservation + generic cron). Цей файл — **problem statement only** (секції 1-3: опис дефекту, технічний root cause, вплив). Секція 4 — короткий orientation-блок з посиланням на authoritative plan.
>
> **Статус:** Реалізовано (v3). Durable reservation pattern з claim-first commit, compensation-in-reservation, generic cron reconciler.
>
> **Критичність:** Висока. Прямий обхід білінгу і lifetime free-tier ліміту. Дозволяє ескалувати реальну вартість Anthropic API на нашу кишеню.

---

## 1. Опис проблеми (простими словами)

Уяви, що в тебе на рахунку рівно на одну каву. Ти підходиш до пʼяти бариста одночасно і кажеш кожному "наливай". Кожен бариста перевіряє твій баланс — бачить що грошей вистачає на одну — і починає наливати. Усі пʼять кав уже у тебе в руках, і тільки тоді каса намагається списати. Списується одна. Решта чотири — безкоштовно.

Так само працює зараз AI-чат: користувач може запустити багато паралельних запитів, отримати багато відповідей від Claude і заплатити лише за один. Ми платимо Anthropic за всі ці відповіді з власної кишені. Так само обходиться "безкоштовний ліміт": людина має право на 5 запитів, а може зробити 50, якщо запустить їх одночасно.

---

## 2. Технічний опис (root cause)

### 2.1 Залучені точки в коді

Назви файлів і рядки наводяться як орієнтир станом на момент виявлення проблеми. Перед імплементацією треба перевірити поточний стан — структура може змінитись.

| Точка | Що робить | Чому є частиною проблеми |
|-------|-----------|-------------------------|
| `AiRateLimitGuard.checkAccountLimit` | Читає `ai.requestsUsed` зі snapshot документа користувача, отриманого попереднім guard-ом, і кидає `AI_LIMIT_EXHAUSTED` коли значення досягло ліміту | Snapshot — це фотографія стану ДО запиту. Конкурентні запити бачать однакову фотографію і всі проходять перевірку. |
| Pre-stream balance check у контролері AI чату | Перевіряє `executions.balance >= AI_CHAT_COST` на тому самому snapshot документа | Та сама проблема: усі N паралельних запитів проходять перевірку одночасно. |
| Тіло контролера AI чату | Стрімить SSE з Anthropic, накопичує текст відповіді, і лише після завершення викликає метод фіналізації | Витрата токенів Anthropic відбувається ТУТ, у кілька потоків паралельно. Гроші вже списано з нашого боку. |
| `AiService.finalizeChat` | Робить атомарний conditional update, який списує executions і інкрементує `ai.requestsUsed`, з guard-ом `balance >= cost` | Атомарність ТУТ захищає лише від негативного балансу. До цього моменту стрім уже завершився і відповідь у клієнта. |

### 2.2 Часова діаграма експлойту

Початковий стан: `executions.balance = 200`, `ai.requestsUsed = limit - 1`.

```
T0   Клієнт → надсилає 5 паралельних POST /ai/chat
T1   Усі 5 запитів: JwtActiveGuard завантажує User
        → snapshot у кожного: balance=200, requestsUsed=limit-1
T2   Усі 5: AiRateLimitGuard.checkAccountLimit() → PASS (бачать limit-1 < limit)
T3   Усі 5: pre-stream check → PASS (бачать 200 >= 200)
T4   Усі 5: SSE headers відправлені
T5   Усі 5: запуск стрімів до Anthropic API
        ↑ ТУТ ми платимо Anthropic за 5 повних відповідей
T6   Усі 5: стріми завершуються, у клієнта 5 повних відповідей AI
T7   Запит #1: finalizeChat → atomic update успішний → balance=0, requestsUsed=limit
T7   Запити #2-5: finalizeChat → atomic update fail (balance=0)
        → throw "Insufficient executions during finalization"
        → SSE error event клієнту (але клієнт уже отримав повну відповідь!)

Підсумок:
  - Користувач отримав 5 AI-відповідей
  - Списано 200 executions (за 1 відповідь)
  - requestsUsed інкрементовано на 1 (а не на 5)
  - Anthropic зняв з нашого акаунта вартість 5 запитів
```

### 2.3 Чому existing захисти НЕ покривають цей кейс

| Захист | Чому не працює |
|--------|----------------|
| IP rate limit (атомарний Lua INCR+EXPIRE у тому ж guard) | Атомарний і коректний — але це **per-IP** ліміт за 24 години. Він НЕ запобігає burst-у з кількох паралельних запитів у межах ліміту. Атакуючий просто робить стільки паралельних запитів, скільки дозволяє IP-ліміт. |
| Atomic guard у `finalizeChat` | Захищає виключно інваріант "balance не може стати негативним". Не захищає від уже надісланої клієнту відповіді і вже сплачених Anthropic токенів. |
| `JwtActiveGuard` | Перевіряє лише валідність токена і soft-delete. Не має жодного відношення до rate limiting. |

### 2.4 Заявлений vs реальний інваріант

CLAUDE.md і документація `docs/sprints/ai-chat/` декларують:
- **"3-layer protection"** — насправді 1 шар (IP) атомарний, 2 шари (account, balance) — TOCTOU.
- **"Debit only on success"** — насправді "debit only for one success out of N concurrent". Решта успіхів безкоштовні.

---

## 3. Вплив

| Категорія | Вплив |
|-----------|-------|
| **Фінансовий (Anthropic API)** | Прямі витрати на наш Anthropic-акаунт. Один зловмисник у межах IP-ліміту = десятки запитів на день безкоштовно. Botnet з багатьох IP — лінійне масштабування витрат без upper bound у бізнес-логіці. |
| **Бізнес (lifetime free limit)** | Lead може отримати десятки безкоштовних AI-відповідей замість 5. Це руйнує конверсійну воронку: ціль чату — після вичерпання 5 запитів показати brief-форму і конвертувати ліда. Якщо ліміт обходиться, brief-форма ніколи не зʼявляється. |
| **Платні користувачі** | Користувач, що купив executions pack, може витратити в N разів більше реальних AI-відповідей, ніж заплатив. Прямий збиток на маржу. |
| **Цілісність ledger** | `ExecutionTransaction` записи коректні (одна транзакція на одне успішне списання), але реальна "робота" виконана у N разів більша. Audit trail виглядає чистим, аномалію не видно з ledger-у — інцидент стає невидимим у звітах. |

---

## 4. Виправлення

Архітектурний план виправлення — у [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) (v3).

Короткий orientation для нового читача:

- **Принцип:** Reserve → Stream → Commit/Refund з **durable persisted reservation** у `User.executions.activeReservation`, **claim-first** порядком commit-у в Mongo transaction, і **compensation-in-reservation** для generic refund / cron reconciliation.
- **Crash-window закритий системно** (не "accepted risk"): cron-reconciler у `UsersService` кожні 5 хвилин знаходить expired reservations і викликає generic refund.
- **Abort policy:** non-refundable після першого токена від AI provider; refundable до нього.
- **Boilerplate value:** generic reservation primitives (`UsersService.commitReservation`, `refundReservation`, cron) переповідаються будь-яким майбутнім usage-based feature через `compensationOps` у самій reservation.

Раніше в цьому файлі був v1-план із "accepted risk" для crash-window, без durable reservation, без розшарування core/feature. Він був замінений у v3 після архітектурного рев'ю — **не використовуйте його як інструкцію**.

---

## 5. Implementation outcome

Реалізація виконана за `IMPLEMENTATION_PLAN.md` v3. Ключові зміни:

- **Schema:** `User.executions.activeReservation` embedded subdocument з `compensationOps`. `ExecutionTransaction.reservationId` з unique sparse index.
- **Core API:** `UsersService.commitReservation()` (MongoDB transaction, claim-first), `refundReservation()` (atomic single-doc, idempotent). `ReservationReconcileService` — generic cron кожні 5 хвилин.
- **AI feature:** `AiService.reserveChatRequest()` (atomic reserve з balance + account limit + single-flight), `commitChatRequest()`, `refundChatRequest()`. `AiRateLimitGuard` спрощений до IP-only.
- **Controller:** exit matrix з 8 сценаріями, non-refundable after first token.
- **Frontend:** `EXECUTIONS_RESERVATION_ACTIVE` (409) error handling + inline non-refundable abort warning.
- **Types:** `RESPONSE_CODE.EXECUTIONS_RESERVATION_ACTIVE`, `AI_CHAT_RESERVATION_TTL_MS`.

**Backlog:** міграція `UsersService.spendExecutions` на reservation primitives (той самий TOCTOU-клас у меншому масштабі).
