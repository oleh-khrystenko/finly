# Automated Tests — Payments

> Опис покриття та структури автоматизованих тестів для payments flow. Всі тести реалізовані та проходять. Source of truth — реальний код у `apps/api/src/modules/payments/` та `apps/web/src/shared/api/payments.ts`.

---

## Покриття

Unit та e2e тести для повного покриття платіжної підсистеми CyanShip.

**Scope:**

- Backend unit тести (PaymentsService, PaymentsController, StripeService)
- Backend e2e тести (HTTP endpoints через Supertest) — **ДОПОВНЕННЯ** існуючих
- Frontend unit тести (API client функції) — **ДОПОВНЕННЯ** існуючих

**Що вже існує (НЕ переписувати, тільки доповнювати):**
- `apps/api/src/common/guards/subscription.guard.spec.ts` — 6 сценаріїв, повне покриття SubscriptionGuard
- `apps/api/test/payments.e2e-spec.ts` — 800+ рядків: checkout (sub + one-off), portal, webhook, idempotency, feature flags, response format
- `apps/web/src/shared/api/payments.spec.ts` — 130 рядків: createSubscriptionCheckout, createOneOffCheckout, createPortalSession

---

## Порядок виконання

Виконуй задачі послідовно. Кожен крок залежить від попереднього.

### Крок 1: Вивчи кодову базу

Перш ніж писати будь-який тест — прочитай і зрозумій:

1. **Імплементацію** — зрозумій реальні сигнатури методів, логіку, edge cases:
   - `apps/api/src/modules/payments/payments.service.ts` — основна логіка (createCheckoutSession, createPortalSession, handleWebhook + private методи)
   - `apps/api/src/modules/payments/payments.controller.ts` — 3 endpoints, raw body, signature validation
   - `apps/api/src/modules/payments/providers/stripe.service.ts` — Stripe adapter, event parsing, status mapping
   - `apps/api/src/modules/payments/interfaces/payment-provider.interface.ts` — IPaymentProvider інтерфейс, CreateCheckoutInput
   - `apps/api/src/modules/payments/schemas/processed-webhook-event.schema.ts` — Mongoose schema для two-phase idempotency (status: 'pending' | 'applied')
   - `apps/api/src/common/guards/subscription.guard.ts` — SubscriptionGuard (вже покритий тестами)
   - `apps/api/src/modules/users/schemas/user.schema.ts` — User schema з billing subdocument
   - `apps/api/src/modules/users/users.service.ts` — addCredits, deductCredit (для one-off)
   - `apps/api/src/config/env.ts` — ENV, STRIPE_CREDIT_PACKS, feature flags
2. **Існуючі тести** — зрозумій patterns мокування, структуру, стиль assertions:
   - `apps/api/src/modules/auth/auth.service.spec.ts` — патерн мокування Mongoose Model + Redis
   - `apps/api/src/modules/auth/auth.controller.spec.ts` — патерн мокування Controller + Response object
   - `apps/api/src/modules/users/users.service.spec.ts` — патерн мокування findById, lean()
   - `apps/api/test/payments.e2e-spec.ts` — **ВИВЧИТИ УВАЖНО** — вже покриває: subscription/one-off checkout, portal, webhook basic flow, idempotency, feature flags, response format
   - `apps/api/src/common/guards/subscription.guard.spec.ts` — **ВЖЕ ПОВНІСТЮ ПОКРИТИЙ** — не дублювати
   - `apps/web/src/shared/api/payments.spec.ts` — **ВЖЕ ІСНУЄ** — покриває createSubscriptionCheckout, createOneOffCheckout, createPortalSession
3. **Types з packages/types:**
   - `packages/types/src/contracts/payments.ts` — PAYMENT_TYPE, SUBSCRIPTION_STATUS, BILLING_EVENT_TYPE (4 types: CHECKOUT_COMPLETED, SUBSCRIPTION_UPDATED, SUBSCRIPTION_DELETED, ONE_OFF_PAYMENT_COMPLETED), CreateCheckoutSessionSchema (discriminated union), BillingWebhookEventSchema, CREDIT_PACK_CONFIG
   - `packages/types/src/enums/response-code.ts` — ALREADY_SUBSCRIBED, NO_BILLING_ACCOUNT, SUBSCRIPTION_REQUIRED, PAYMENT_TYPE_DISABLED
4. **Frontend:**
   - `apps/web/src/shared/api/payments.ts` — createSubscriptionCheckout(planCode), createOneOffCheckout(packCode), createPortalSession()
   - `apps/web/src/shared/api/client.ts` — apiClient instance

### Крок 2: Backend unit тести
### Крок 3: Backend e2e тести (доповнення)
### Крок 4: Frontend unit тести (перевірка)

---

## Constraints (обов'язкові правила)

1. **НЕ змінюй існуючі тести.** Тільки додавай нові файли або, у випадку e2e, нові `describe`/`it` блоки до існуючого файлу.
2. **Дотримуйся існуючих patterns.** Мокування Mongoose Model (getModelToken, jest.fn()), mock provider через DI — копіюй з існуючих spec файлів.
3. **Читай реальний код перед написанням тесту.** Перевіряй сигнатури методів, назви полів, MongoDB error codes, HTTP статуси — бери з імплементації.
4. **Один тест = одна поведінка.** Не перевіряй кілька речей в одному `it()`.
5. **Слідуй проектним конвенціям** — прочитай `CLAUDE.md` в корені проекту.
6. **Запускай тести після кожного файлу.** Переконайся, що нові тести проходять.
7. **Не додавай нові залежності до API** без необхідності. Все потрібне вже є.
8. **НЕ мокуй реальний Stripe SDK.** Мокуй `IPaymentProvider` через DI token (`PAYMENT_PROVIDER`), не `StripeService` напряму. StripeService тестується окремо з мокованим `stripe` module.

---

## Крок 2: Backend Unit Tests

### 2.1 `apps/api/src/modules/payments/payments.service.spec.ts` (40 тестів)

Покриває всі залежності та логіку `payments.service.ts`.

**УВАГА: Ключові деталі імплементації:**
- `createCheckoutSession(userId: string, dto: CreateCheckoutSession)` — приймає повний DTO (НЕ planCode окремо)
- `handleWebhook` використовує two-phase idempotency: insert 'pending' → process → mark 'applied', rollback на failure
- Subscription billing update: atomic `findOneAndUpdate` з `$or` guard (НЕ findByIdAndUpdate) + two-phase (dot-notation для existing billing, full object для null billing)
- One-off payments: `applyOneOffPayment` → `usersService.addCredits`

**Мокування:**
- `PAYMENT_PROVIDER` token — mock об'єкт з `createCheckoutSession`, `createPortalSession`, `handleWebhookPayload` як `jest.fn()`
- `userModel` — через `getModelToken(User.name)`, methods: `findById`, `findOne`, `findOneAndUpdate` як `jest.fn()`. Для chainable: `findById().lean()`, `findById().maxTimeMS().lean()`
- `webhookEventModel` — через `getModelToken(ProcessedWebhookEvent.name)`, methods: `create`, `findOne`, `updateOne`, `deleteOne` як `jest.fn()`. Для chainable: `findOne().lean()`
- `usersService` — mock з `addCredits` як `jest.fn()`

#### Subscription checkout (`createCheckoutSession` з `paymentType: 'subscription'`)

- Юзер без підписки → викликає `paymentProvider.createCheckoutSession` з правильними аргументами (userId, userEmail, paymentType, planCode, priceId з ENV, successUrl, cancelUrl) → повертає `{ checkoutUrl }`
- Юзер з активною підпискою (`hasActiveSubscription: true`) → кидає `ConflictException` з `code: RESPONSE_CODE.ALREADY_SUBSCRIBED`
- Юзер не знайдений → кидає `BadRequestException`
- `PAYMENTS_SUBSCRIPTION_ENABLED = false` → кидає `BadRequestException` з `code: RESPONSE_CODE.PAYMENT_TYPE_DISABLED`
- Юзер з existing `providerCustomerId` → передає його в `createCheckoutSession` input

#### One-off checkout (`createCheckoutSession` з `paymentType: 'one_off'`)

- Юзер + valid packCode ('credits_5') → викликає `paymentProvider.createCheckoutSession` з priceId з `STRIPE_CREDIT_PACKS`, credits з pack config → повертає `{ checkoutUrl }`
- Invalid packCode → кидає `BadRequestException('Invalid packCode')`
- `PAYMENTS_ONE_OFF_ENABLED = false` → кидає `BadRequestException` з `code: RESPONSE_CODE.PAYMENT_TYPE_DISABLED`

#### Portal (`createPortalSession`)

- Юзер з `providerCustomerId` → викликає `paymentProvider.createPortalSession(providerCustomerId)` → повертає `{ portalUrl }`
- Юзер без `billing` subdocument → кидає `BadRequestException` з `code: RESPONSE_CODE.NO_BILLING_ACCOUNT`
- Юзер з `billing.providerCustomerId: null` → кидає `BadRequestException` з `code: RESPONSE_CODE.NO_BILLING_ACCOUNT`
- Юзер не знайдений → кидає `BadRequestException`

#### Webhook — basic flow (`handleWebhook`)

- `paymentProvider.handleWebhookPayload` повертає `null` → метод повертає без дій (unknown event)
- Повний happy path для `CHECKOUT_COMPLETED`:
  1. `handleWebhookPayload` повертає event з userId і типом CHECKOUT_COMPLETED
  2. `webhookEventModel.create` успішно вставляє (не дублікат) зі status 'pending'
  3. `userModel.findOneAndUpdate` викликається з atomic `$or` guard на `lastProviderEventAt`
  4. `webhookEventModel.updateOne` маркує event як 'applied'
  5. Billing update включає: `billing.provider: 'stripe'`, `billing.hasActiveSubscription: true`, `billing.providerCustomerId`, `billing.providerSubscriptionId`, `billing.planCode`, `billing.currency`

#### Webhook — userId resolution (`resolveUserId`)

- Event з непустим `userId` → використовується напряму, `userModel.findOne` НЕ викликається
- Event з порожнім `userId` і `raw.id` є string → шукає user через `findOne({ 'billing.providerSubscriptionId': raw.id })` → повертає userId
- Event з порожнім `userId` і без `raw.id` → log warning, повертає без дій
- `findOne` не знаходить user для subscriptionId → log warning, повертає без дій

#### Webhook — two-phase idempotency (`insertWebhookEvent`)

- `webhookEventModel.create` кидає MongoDB duplicate key error (code 11000):
  - existing event має `status: 'applied'` → повертає без дій (already processed)
  - existing event має `status: 'pending'` → продовжує обробку (retry)
- `webhookEventModel.create` кидає інший error → помилка пропагується

#### Webhook — rollback on failure

- `processWebhookEvent` кидає помилку → `rollbackPendingWebhookEvent` видаляє pending record (deleteOne з `status: 'pending'`) → помилка re-throw
- `deleteOne` в rollback теж кидає помилку → логується, оригінальна помилка re-throw

#### Webhook — out-of-order (subscription events)

- Atomic MongoDB guard: `findOneAndUpdate` з `$or: [{ lastProviderEventAt: null }, { lastProviderEventAt: { $lte: event.occurredAt } }]`
- Phase 1 (existing billing): `findOneAndUpdate` з `{ billing: { $ne: null } }` + out-of-order guard → повертає updated doc
- Phase 2 (null billing, first event): якщо Phase 1 returned null → `findOneAndUpdate` з `{ billing: null }` → sets full billing object
- Обидві фази returned null → skip (stale/orphan event), logged

#### Webhook — billing state per event type (`buildBillingUpdate`)

- `CHECKOUT_COMPLETED`: `provider = 'stripe'`, `providerCustomerId` з raw.customer, `providerSubscriptionId` з raw.subscription, `planCode` з raw.metadata.planCode, `currency` з raw.currency, `providerSubscriptionStatus` з raw.status, `hasActiveSubscription = true` (status ACTIVE)
- `SUBSCRIPTION_UPDATED` з status ACTIVE: `hasActiveSubscription = true`, updates `subscriptionStatus`, `currentPeriodEnd`, `cancelAtPeriodEnd`
- `SUBSCRIPTION_UPDATED` з status TRIALING: `hasActiveSubscription = true`
- `SUBSCRIPTION_UPDATED` з status PAST_DUE: `hasActiveSubscription = false`
- `SUBSCRIPTION_DELETED`: `subscriptionStatus = 'CANCELED'`, `hasActiveSubscription = false`, `providerSubscriptionStatus = 'canceled'`

#### Webhook — one-off payment (`applyOneOffPayment`)

- `ONE_OFF_PAYMENT_COMPLETED` з `creditsAmount: 5` → `usersService.addCredits(userId, 5)` called
- `ONE_OFF_PAYMENT_COMPLETED` з `creditsAmount: 0` → skip, addCredits NOT called, log warning
- `ONE_OFF_PAYMENT_COMPLETED` з `creditsAmount: undefined` → skip (fallback to 0)
- `ONE_OFF_PAYMENT_COMPLETED` з `creditsAmount: -5` → skip (not positive)
- User not found for one-off event → log warning, return without calling addCredits

### 2.2 `apps/api/src/modules/payments/payments.controller.spec.ts` (8 тестів)

Покриває `payments.controller.ts`.

**УВАГА:** Контролер передає повний DTO в service, не окремі поля.

**Мокування:** Mock `PaymentsService` повністю. Mock `Request` object з `rawBody` (Buffer), `headers`. Mock `@CurrentUser()` через `request.user`.

| Endpoint | Що тестувати |
|---|---|
| `POST /payments/checkout-session` | Виклик `paymentsService.createCheckoutSession(user._id.toString(), dto)` з повним DTO. Response format `{ data: { checkoutUrl } }`. |
| `POST /payments/portal-session` | Виклик `paymentsService.createPortalSession(user._id.toString())`. Response format `{ data: { portalUrl } }`. |
| `POST /payments/webhook/stripe` | Успішна обробка — передає `provider='stripe'`, `rawBody` (Buffer), `signature` в `paymentsService.handleWebhook`; повертає `{ received: true }`. |
| `POST /payments/webhook/stripe` | Missing `rawBody` (req.rawBody = undefined) → кидає `BadRequestException('Missing raw body')`. |
| `POST /payments/webhook/stripe` | Missing `signature` (header відсутній) → кидає `BadRequestException('Missing webhook signature')`. |
| `POST /payments/webhook/unknown` | Unsupported provider → кидає `BadRequestException('Unsupported provider: unknown')`. Provider перевіряється через `static SUPPORTED_PROVIDERS = new Set(['stripe'])`. |

### 2.3 `apps/api/src/modules/payments/providers/stripe.service.spec.ts`

Покриває `stripe.service.ts`.

**Мокування:** Mock весь `stripe` module через `jest.mock('stripe')`. Конструктор повертає mock об'єкт з `checkout.sessions.create`, `billingPortal.sessions.create`, `webhooks.constructEvent` як `jest.fn()`.

**Метод `createCheckoutSession`:**
- Subscription: mode='subscription', передає правильний `price`, `metadata.userId`, `metadata.planCode`, `client_reference_id`, `success_url`, `cancel_url`. З `providerCustomerId` → `customer`. Без → `customer_email`.
- One-off: mode='payment', `metadata.credits` = String(credits), `metadata.planCode` = packCode
- `session.url` є → повертає `{ checkoutUrl: session.url, providerSessionId: session.id }`
- `session.url` відсутній → кидає Error('Stripe checkout session created without URL')

**Метод `createPortalSession`:**
- Передає `customer: providerCustomerId`, `return_url: ENV.BILLING_SUCCESS_URL`
- Повертає `{ portalUrl: session.url }`

**Метод `handleWebhookPayload`:**
- `checkout.session.completed` mode=subscription → `type: CHECKOUT_COMPLETED`, `userId` з `metadata.userId`, `subscriptionStatus: ACTIVE`
- `checkout.session.completed` mode=payment, paid → `type: ONE_OFF_PAYMENT_COMPLETED`, `creditsAmount` з metadata.credits, `packCode` з metadata.planCode
- `checkout.session.completed` mode=payment, unpaid → повертає `null`
- `checkout.session.completed` без `metadata.userId` → fallback до `client_reference_id`
- `checkout.session.async_payment_succeeded` → same handling as `checkout.session.completed`
- `customer.subscription.updated` з status `active` → `type: SUBSCRIPTION_UPDATED`, `subscriptionStatus: ACTIVE`, `userId: ''` (порожній)
- `customer.subscription.updated` з status `past_due` → `subscriptionStatus: PAST_DUE`
- `customer.subscription.deleted` → `type: SUBSCRIPTION_DELETED`, `subscriptionStatus: CANCELED`
- Невідомий event type (напр. `payment_intent.created`) → повертає `null`

**`mapSubscriptionStatus` (через handleWebhookPayload):**
- `'active'` → `ACTIVE`
- `'trialing'` → `TRIALING`
- `'past_due'` → `PAST_DUE`
- `'canceled'` → `CANCELED`
- `'incomplete'` → `INCOMPLETE`
- `'unpaid'` → `UNPAID`
- `'incomplete_expired'` → `CANCELED`
- `'paused'` → `UNKNOWN`
- Невідомий статус → `UNKNOWN`

### 2.4 `apps/api/src/common/guards/subscription.guard.spec.ts` (6 тестів)

Повне покриття:
- `hasActiveSubscription === true` → true
- `hasActiveSubscription === false` → ForbiddenException(SUBSCRIPTION_REQUIRED)
- `billing === null` → ForbiddenException
- `billing === undefined` → ForbiddenException
- `user === undefined` → ForbiddenException
- `hasActiveSubscription === true` (TRIALING) → true

---

## Крок 3: Backend E2E Tests — доповнення

### Файл: `apps/api/test/payments.e2e-spec.ts` (29 тестів)

Файл містить 1000+ рядків тестів.

**Покриття:**
- A. `POST /api/payments/checkout-session` — 5 тестів (sub + auth + validation)
- B. `POST /api/payments/portal-session` — 4 тести (success + no billing + null customerId + auth)
- C. `POST /api/payments/webhook/:provider` — 3 тести (valid + no signature + bad provider)
- D. Response format — 3 тести
- E. One-off checkout — 3 тести (success + bad pack + credits webhook)
- F. Feature flags — 2 тести (disabled subscription + disabled one-off)
- G. Webhook idempotency — 2 тести (duplicate skip + rollback/retry)

**Додатково покрито:**

- **Out-of-order event handling:** два SUBSCRIPTION_UPDATED events — новіший, потім старіший. Старіший skip.
- **Subscription lifecycle:** CHECKOUT_COMPLETED → SUBSCRIPTION_UPDATED(past_due) → SUBSCRIPTION_DELETED.
- **One-off idempotency:** повторний ONE_OFF_PAYMENT_COMPLETED з тим самим providerEventId → credits НЕ додаються вдруге.
- **userId resolution via subscription lookup:** SUBSCRIPTION_UPDATED з порожнім userId → resolved через `billing.providerSubscriptionId`.

---

## Крок 4: Frontend Unit Tests — перевірка

### `apps/web/src/shared/api/payments.spec.ts` (9 тестів)

Покриття:
- `createSubscriptionCheckout(planCode)` — POST `/api/payments/checkout-session` з `{ paymentType: 'subscription', planCode }`
- `createOneOffCheckout(packCode)` — POST `/api/payments/checkout-session` з `{ paymentType: 'one_off', packCode }`
- `createPortalSession()` — POST `/api/payments/portal-session`
- Error propagation для кожної функції

**Перевір:** Запусти `pnpm --filter web test` і переконайся що всі тести проходять.

---

## Верифікація

Після завершення всіх кроків:

```bash
# 1. Backend unit tests
pnpm --filter api test

# 2. Backend e2e tests
pnpm --filter api test:e2e

# 3. Frontend unit tests
pnpm --filter web test

# 4. Coverage report
pnpm --filter api test:cov
# Target: >80% coverage для payments module

# 5. Full build (переконатися що нічого не зламано)
pnpm build
```

**Критерії успіху:**
- Всі тести проходять (exit code 0)
- Нові unit тести покривають: PaymentsService (checkout sub + one-off, portal, webhook all 4 event types, two-phase idempotency, out-of-order, rollback, userId resolution, applyOneOffPayment edge cases), PaymentsController (3 endpoints + validation), StripeService (checkout, portal, webhook parsing + status mapping)
- Існуючі тести не змінені та все ще проходять
- Жоден тест не залежить від зовнішніх сервісів (Stripe API, MongoDB Atlas)
- Coverage payments module > 80%
