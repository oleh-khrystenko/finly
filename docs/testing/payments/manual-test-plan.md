# Manual E2E Test Plan: повний payments flow

> Покрокові сценарії для ручного тестування. Покриває всю платіжну підсистему: Stripe Checkout (subscription + one-off), Billing Portal, Webhook handling, SubscriptionGuard, Billing page UI (subscription + credits sections).

Дата: 2026-03-04

---

## Підготовка

- DevTools відкриті (вкладки: `Network`, `Application -> Cookies`, `Console`)
- У `Network` увімкнити `Preserve log`
- **Stripe CLI встановлений** (для webhook тестів: `stripe listen --forward-to localhost:4000/api/payments/webhook/stripe`)
- **Stripe Dashboard** відкритий (для перевірки customer, subscription, events)
- Тестовий акаунт авторизований
- Response format: `{ data: { ... } }` для success, `{ error: { code, message } }` для errors
- API має глобальний префікс `/api`

### Тестові Stripe картки

| Сценарій | Номер картки |
|---|---|
| Успішна оплата | `4242 4242 4242 4242` |
| Оплата відхилена | `4000 0000 0000 0002` |
| 3D Secure | `4000 0025 0000 3155` |

Для всіх тестових карток: будь-яка майбутня дата, будь-який CVC, будь-який поштовий індекс.

---

## A. Subscription Checkout Flow

### Тест A1: Успішна підписка — повний flow

**Мета:** Перевірити повний checkout flow від billing page до активної підписки.

**Precondition:** Авторизований юзер без активної підписки. Stripe CLI запущений (`stripe listen --forward-to localhost:4000/api/payments/webhook/stripe`).

**Steps:**
1. Перейти на `/{locale}/billing`
2. Побачити стан "Оформіть підписку"
3. Натиснути "Оформити підписку"
4. Дочекатись redirect на Stripe Checkout
5. Заповнити тестову картку `4242 4242 4242 4242`
6. Підтвердити оплату

**Expected:**
- [ ] Network: `POST /api/payments/checkout-session` → 201, `{ data: { checkoutUrl: 'https://checkout.stripe.com/...' } }`
- [ ] Кнопка показує spinner під час API call
- [ ] Browser переходить на `checkout.stripe.com`
- [ ] Після успішної оплати → redirect на `{BILLING_SUCCESS_URL}` (напр. `/billing/success`)
- [ ] Stripe CLI: видно події `checkout.session.completed` та `customer.subscription.updated`
- [ ] Network: `POST /api/payments/webhook/stripe` → 201 двічі (для кожної події)
- [ ] Stripe Dashboard: subscription зі статусом `active`

---

### Тест A2: Checkout — вже є активна підписка

**Precondition:** Авторизований юзер з активною підпискою.

**Steps:**
1. Відкрити DevTools Console
2. Виконати: `fetch('/api/payments/checkout-session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer TOKEN' }, body: JSON.stringify({ paymentType: 'subscription', planCode: 'monthly_usd' }) }).then(r => r.json()).then(console.log)`

**Expected:**
- [ ] Response: 409, `{ error: { code: 'ALREADY_SUBSCRIBED', message: '...' } }`
- [ ] Billing page: кнопки "Оформити підписку" немає (UI показує активний стан)

---

### Тест A3: Checkout — відмова від оплати

**Precondition:** Авторизований юзер без підписки.

**Steps:**
1. Billing page → натиснути "Оформити підписку"
2. На Stripe Checkout натиснути "Back" або закрити вкладку

**Expected:**
- [ ] Browser переходить на `{BILLING_CANCEL_URL}` (cancel URL)
- [ ] Підписка НЕ активується
- [ ] Billing page: досі стан "Оформіть підписку"

---

### Тест A4: Checkout — картка відхилена

**Steps:**
1. Stripe Checkout → ввести картку `4000 0000 0000 0002`
2. Підтвердити оплату

**Expected:**
- [ ] Stripe Checkout показує error "Ваша картка відхилена"
- [ ] Залишається на checkout page
- [ ] Webhook НЕ надходить (оплата не пройшла)

---

## B. Billing Portal

### Тест B1: Відкриття billing portal

**Precondition:** Авторизований юзер з активною підпискою.

**Steps:**
1. Перейти на `/{locale}/billing`
2. Побачити стан "Ваша підписка"
3. Натиснути "Керувати підпискою"

**Expected:**
- [ ] Network: `POST /api/payments/portal-session` → 201, `{ data: { portalUrl: 'https://billing.stripe.com/...' } }`
- [ ] Кнопка показує spinner під час API call
- [ ] Browser переходить на `billing.stripe.com` (Stripe Customer Portal)
- [ ] Portal показує поточну підписку, опцію скасування, платіжні методи

---

### Тест B2: Portal — немає billing account

**Precondition:** Авторизований юзер, у якого немає `billing.providerCustomerId` (наприклад, білінг запис відсутній).

**Steps:**
1. DevTools Console: `fetch('/api/payments/portal-session', { method: 'POST', headers: { 'Authorization': 'Bearer TOKEN' } }).then(r => r.json()).then(console.log)`

**Expected:**
- [ ] Response: 400, `{ error: { code: 'NO_BILLING_ACCOUNT', message: '...' } }`

---

### Тест B3: Скасування підписки через portal

**Precondition:** Авторизований юзер з активною підпискою.

**Steps:**
1. Billing Portal → Cancel Plan → підтвердити
2. Portal → Back to site
3. Повернутись на `/{locale}/billing`

**Expected:**
- [ ] Stripe CLI: `customer.subscription.updated` з `cancel_at_period_end: true`
- [ ] Після webhook: billing page показує стан C (canceling) — "Активна до {date}"
- [ ] Network: `GET /api/users/me` → відповідь містить `billing.cancelAtPeriodEnd: true`

---

## C. Webhook Handling

> **Увага:** Тести C1-C5 виконуються через Stripe CLI або Stripe Dashboard.

### Тест C1: checkout.session.completed → billing state

**Precondition:** Stripe CLI запущений.

**Steps:**
1. Виконати: `stripe trigger checkout.session.completed --add checkout_session:metadata.userId=USER_ID_FROM_DB`
2. Перевірити MongoDB (через Mongo Compass або API `/api/users/me`)

**Expected:**
- [ ] Stripe CLI: `POST /api/payments/webhook/stripe` → 201, `{ received: true }`
- [ ] MongoDB: user має `billing.provider: 'stripe'`, `billing.providerCustomerId`, `billing.hasActiveSubscription: true`
- [ ] `apps/api` logs: `Processed CHECKOUT_COMPLETED for user {userId}`

---

### Тест C2: customer.subscription.updated → status change

**Precondition:** Юзер має активну підписку.

**Steps:**
1. Stripe Dashboard → Subscriptions → знайти підписку → Past due (або через API)
2. Перевірити webhook та billing state

**Expected:**
- [ ] Webhook → 201
- [ ] `billing.subscriptionStatus` оновлено відповідно до нового Stripe статусу
- [ ] `billing.hasActiveSubscription` = true для ACTIVE/TRIALING, false для PAST_DUE/CANCELED/etc
- [ ] `billing.cancelAtPeriodEnd` та `billing.currentPeriodEnd` оновлені

---

### Тест C3: customer.subscription.deleted → billing state

**Precondition:** Юзер має активну підписку.

**Steps:**
1. `stripe trigger customer.subscription.deleted`

**Expected:**
- [ ] Webhook → 201
- [ ] `billing.hasActiveSubscription: false`
- [ ] `billing.subscriptionStatus: 'CANCELED'`
- [ ] Billing page: тепер показує стан "Оформіть підписку"

---

### Тест C4: Webhook idempotency (дублікати)

**Precondition:** Stripe CLI запущений.

**Steps:**
1. Запустити real checkout flow (Тест A1)
2. Знайти event ID в Stripe Dashboard (напр. `evt_xxx`)
3. Stripe Dashboard → Events → Resend event

**Expected:**
- [ ] Перший webhook → 201 (processed)
- [ ] Повторний webhook → 201 (idempotent, не double-process)
- [ ] `apps/api` logs: `Duplicate webhook event evt_xxx, already applied`
- [ ] MongoDB: billing state НЕ змінився вдруге

---

### Тест C5: Webhook — невідомий provider

**Steps:**
1. `curl -X POST http://localhost:4000/api/payments/webhook/monobank -H "Content-Type: application/json" -d '{}'`

**Expected:**
- [ ] Response: 400, `{ error: { code: ..., message: 'Unsupported provider: monobank' } }`

---

### Тест C6: Webhook — відсутній signature

**Steps:**
1. `curl -X POST http://localhost:4000/api/payments/webhook/stripe -H "Content-Type: application/json" -d '{}'`

**Expected:**
- [ ] Response: 400, `{ error: { ..., message: 'Missing webhook signature' } }`

---

### Тест C7: Webhook — неправильна signature

**Steps:**
1. `curl -X POST http://localhost:4000/api/payments/webhook/stripe -H "stripe-signature: t=fake,v1=fake" -H "Content-Type: application/json" -d '{}'`

**Expected:**
- [ ] Response: 400 або 500 (Stripe signature verification failed)
- [ ] `apps/api` logs: Stripe signature error

---

## D. One-Off Payments (Credit Packs)

### Тест D1: Успішна купівля кредитного пакету

**Precondition:** Авторизований юзер. Stripe CLI запущений. Початковий credits.balance = 0.

**Steps:**
1. Перейти на `/{locale}/billing`
2. У секції "Кредити" натиснути кнопку купівлі для пакету 5 кредитів
3. На Stripe Checkout заповнити картку `4242 4242 4242 4242`
4. Підтвердити оплату

**Expected:**
- [ ] Network: `POST /api/payments/checkout-session` → 201 з `{ data: { checkoutUrl } }`
- [ ] Request body: `{ paymentType: 'one_off', packCode: 'credits_5' }`
- [ ] Browser переходить на Stripe Checkout (mode=payment)
- [ ] Після оплати → redirect на `/billing/success`
- [ ] Stripe CLI: `checkout.session.completed` webhook → 201
- [ ] MongoDB: `credits.balance` = 5 (was 0)
- [ ] Header: credits badge показує 5

---

### Тест D2: Купівля кредитів — другий пакет (accumulation)

**Precondition:** Юзер вже має 5 кредитів (після D1).

**Steps:**
1. Купити ще один пакет (10 кредитів)

**Expected:**
- [ ] MongoDB: `credits.balance` = 15 (5 + 10)
- [ ] Credits accumulate, не перезаписуються

---

### Тест D3: Невалідний packCode

**Steps:**
1. DevTools Console: `fetch('/api/payments/checkout-session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer TOKEN' }, body: JSON.stringify({ paymentType: 'one_off', packCode: 'credits_999' }) }).then(r => r.json()).then(console.log)`

**Expected:**
- [ ] Response: 400 (validation error від Zod — packCode not in allowed enum)

---

### Тест D4: One-off не вимагає відсутності підписки

**Precondition:** Юзер з активною підпискою.

**Steps:**
1. Купити кредитний пакет

**Expected:**
- [ ] Checkout створюється успішно (one-off не перевіряє hasActiveSubscription)
- [ ] Кредити додаються нормально

---

## E. Feature Flags

### Тест E1: Subscription disabled

**Precondition:** `PAYMENTS_SUBSCRIPTION_ENABLED=false` в env, `PAYMENTS_ONE_OFF_ENABLED=true`.

**Steps:**
1. Перейти на `/{locale}/billing`

**Expected:**
- [ ] Subscription секція НЕ відображається (conditionally rendered via `PAYMENTS_SUBSCRIPTION_ENABLED`)
- [ ] Credits секція відображається
- [ ] API: `POST /checkout-session` з `paymentType: 'subscription'` → 400, code `PAYMENT_TYPE_DISABLED`

---

### Тест E2: One-off disabled

**Precondition:** `PAYMENTS_ONE_OFF_ENABLED=false`, `PAYMENTS_SUBSCRIPTION_ENABLED=true`.

**Steps:**
1. Перейти на `/{locale}/billing`

**Expected:**
- [ ] Credits секція НЕ відображається
- [ ] Subscription секція відображається
- [ ] API: `POST /checkout-session` з `paymentType: 'one_off'` → 400, code `PAYMENT_TYPE_DISABLED`

---

## F. SubscriptionGuard

### Тест F1: Захищений endpoint — без підписки

**Precondition:** Авторизований юзер без активної підписки. Необхідний захищений endpoint з `@UseGuards(JwtAuthGuard, SubscriptionGuard)` — якщо такий є в Reports/Storage, використати його. Інакше тест виконати через unit тест.

**Steps:**
1. Авторизованим запитом спробувати доступ до захищеного SubscriptionGuard endpoint.

**Expected:**
- [ ] Response: 403, `{ error: { code: 'SUBSCRIPTION_REQUIRED', message: '...' } }`

---

### Тест F2: Захищений endpoint — з активною підпискою

**Precondition:** Авторизований юзер з `billing.hasActiveSubscription: true`.

**Expected:**
- [ ] Guard пропускає запит (200 або відповідь сервісу)

---

### Тест F3: SubscriptionGuard — без JWT

**Steps:**
1. Запит без `Authorization` header.

**Expected:**
- [ ] JWT guard відхиляє першим → 401 (SubscriptionGuard навіть не запускається)

---

## G. Billing Page UI

### Тест G1: Стан A — немає підписки

**Precondition:** Авторизований юзер, `billing === null` або `hasActiveSubscription: false`.

**Steps:**
1. Перейти на `/{locale}/billing`

**Expected:**
- [ ] Subscription секція: заголовок `billing_page.subscribe.title`, опис, назва плану, кнопка "Оформити підписку"
- [ ] НЕ відображається інформація про поточну підписку
- [ ] Credits секція: заголовок, опис, поточний баланс (`credits.balance`), кнопки для кожного пакету (5, 10, 20 кредитів)

---

### Тест G2: Стан B — активна підписка

**Precondition:** Авторизований юзер, `billing.hasActiveSubscription: true`, `billing.cancelAtPeriodEnd: false`.

**Steps:**
1. Перейти на `/{locale}/billing`

**Expected:**
- [ ] Subscription секція: заголовок `billing_page.active.title`
- [ ] Статус: "Активна" (`active.status_active`)
- [ ] Назва плану (`active.plan_label` з planCode)
- [ ] Наступне списання (`active.next_billing` з датою)
- [ ] Кнопка "Керувати підпискою" (`active.manage_button`)
- [ ] НЕ відображається `cancel_notice`
- [ ] Credits секція: також відображається (one-off незалежний від subscription)

---

### Тест G3: Стан C — підписка скасована, але активна до кінця періоду

**Precondition:** `billing.hasActiveSubscription: true`, `billing.cancelAtPeriodEnd: true`.

**Steps:**
1. Перейти на `/{locale}/billing`

**Expected:**
- [ ] Статус: "Активна до {date}" (`active.status_canceling`) — з форматованою датою `currentPeriodEnd`
- [ ] Попередження (`active.cancel_notice`): "Підписку буде скасовано..."
- [ ] Кнопка "Керувати підпискою" (для відновлення через Portal)
- [ ] НЕ відображається `next_billing` (не потрібно, бо є cancel_notice)

---

### Тест G4: Credits секція — відображення балансу

**Precondition:** Юзер з `credits.balance: 15`.

**Steps:**
1. Перейти на `/{locale}/billing`

**Expected:**
- [ ] Credits секція показує "Баланс: 15 кредитів" (або відповідний i18n ключ `credits.balance`)
- [ ] Три кнопки купівлі: 5, 10, 20 кредитів (з `CREDIT_PACK_CONFIG`)

---

### Тест G5: Loading state кнопок

**Steps:**
1. Натиснути "Оформити підписку" (або "Купити" кредитний пакет, або "Керувати підпискою")

**Expected:**
- [ ] Кнопка показує spinner (`UiSpinner`) замість тексту
- [ ] Кнопка disabled під час API call
- [ ] Після redirect (або помилки) кнопка повертається в нормальний стан
- [ ] Інші кнопки не блокуються (loadingAction specific per action)

---

### Тест G6: Error handling

**Steps:**
1. Заблокувати `POST /api/payments/checkout-session` через Network tab → Block request URL
2. Натиснути "Оформити підписку"

**Expected:**
- [ ] Toast з error повідомленням (`subscribe.error` ключ)
- [ ] Кнопка знову активна (loadingAction = null)

---

## H. Route Protection

### Тест H1: /billing — неавторизований

**Precondition:** Немає `bid_refresh` cookie.

**Steps:**
1. Відкрити `/{locale}/billing`

**Expected:**
- [ ] Middleware redirect на `/{locale}/auth/signin` (server-side)
- [ ] Billing page контент не рендериться

---

### Тест H2: /billing — авторизований

**Precondition:** Є `bid_refresh` cookie.

**Steps:**
1. Відкрити `/{locale}/billing`

**Expected:**
- [ ] Сторінка рендериться (стан A, B або C залежно від підписки)
- [ ] Немає redirect

---

### Тест H3: /billing/success та /billing/cancel

**Steps:**
1. Відкрити `/{locale}/billing/success`
2. Відкрити `/{locale}/billing/cancel`

**Expected:**
- [ ] Обидві сторінки рендеряться
- [ ] Доступні тільки авторизованим (якщо `/billing` protected, то `layout.tsx` покриває)

---

## I. Billing State — getMe response

### Тест I1: getMe — billing field після підписки

**Precondition:** Юзер з активною підпискою.

**Steps:**
1. `GET /api/users/me` з Authorization header

**Expected:**
- [ ] Response містить `billing` object:
  ```json
  {
    "hasActiveSubscription": true,
    "planCode": "monthly_usd",
    "subscriptionStatus": "ACTIVE",
    "currentPeriodEnd": "2026-04-03T...",
    "cancelAtPeriodEnd": false
  }
  ```
- [ ] Response НЕ містить `billing.providerCustomerId`, `billing.providerSubscriptionId`, `billing.providerSubscriptionStatus` (internal fields filtered by controller)

---

### Тест I2: getMe — billing field без підписки

**Precondition:** Юзер без підписки.

**Steps:**
1. `GET /api/users/me`

**Expected:**
- [ ] `billing: null`

---

### Тест I3: getMe — credits field після one-off

**Precondition:** Юзер з `credits.balance: 10`.

**Steps:**
1. `GET /api/users/me`

**Expected:**
- [ ] Response містить `credits: { balance: 10, freeReportUsed: false }`

---

## J. i18n

### Тест J1: Billing page — Ukrainian

**Steps:**
1. Перейти на `/uk/billing`
2. Перевірити всі тексти (включно з credits секцією)

**Expected:**
- [ ] Заголовки, описи, кнопки — українською
- [ ] Дати форматуються у форматі uk-UA (напр. "15 березня 2026")
- [ ] Credits секція: "Кредити", баланс, кнопки купівлі — українською

---

### Тест J2: Billing page — English

**Steps:**
1. Перейти на `/en/billing`

**Expected:**
- [ ] Заголовки, описи, кнопки — англійською
- [ ] Дати у форматі en-US (напр. "March 15, 2026")
- [ ] Credits секція: "Credits", balance, buy buttons — англійською

---

### Тест J3: Toast повідомлення — payments errors

**Steps:**
1. Спробувати checkout при існуючій підписці (через UI або API)
2. Спробувати portal без billing account

**Expected:**
- [ ] Toast помилки показується відповідно до locale (uk/en)
- [ ] UK: "У вас вже є активна підписка." / "Платіжний акаунт не знайдено..."
- [ ] EN: "You already have an active subscription." / "No billing account found..."

---

## K. Security

### Тест K1: Checkout — JWT required

**Steps:**
1. `POST /api/payments/checkout-session` без Authorization header

**Expected:**
- [ ] Response: 401, `{ error: { code: 'UNAUTHORIZED', message: '...' } }`

---

### Тест K2: Portal — JWT required

**Steps:**
1. `POST /api/payments/portal-session` без Authorization header

**Expected:**
- [ ] Response: 401

---

### Тест K3: Webhook — не підпадає під rate limiting

**Precondition:** ThrottlerGuard глобально обмежує 60 req/60s.

**Steps:**
1. Надіслати 61+ webhook запити підряд (з правильним signature через Stripe CLI)

**Expected:**
- [ ] Всі запити проходять (429 НЕ повертається для `/webhook/:provider`)
- [ ] `@SkipThrottle()` застосований коректно

---

### Тест K4: Webhook — `rawBody: true` не ламає інші endpoints

**Precondition:** `NestFactory.create(AppModule, { rawBody: true })` в main.ts.

**Steps:**
1. Виконати звичайні JSON requests до auth/users endpoints

**Expected:**
- [ ] `POST /api/auth/check-email` → 200 (JSON body парситься нормально)
- [ ] `POST /api/auth/login/password` → 200 або 401 (залежно від credentials)
- [ ] `rawBody: true` не ламає стандартні endpoints

---

## Зведений чеклист

| # | Тест | Категорія | Статус |
|---|------|-----------|--------|
| A1 | Успішна підписка — повний flow | Subscription Checkout | [ ] |
| A2 | Checkout — вже є підписка | Subscription Checkout | [ ] |
| A3 | Checkout — відмова від оплати | Subscription Checkout | [ ] |
| A4 | Checkout — картка відхилена | Subscription Checkout | [ ] |
| B1 | Billing portal — відкриття | Billing Portal | [ ] |
| B2 | Portal — немає billing account | Billing Portal | [ ] |
| B3 | Скасування підписки через portal | Billing Portal | [ ] |
| C1 | checkout.session.completed → billing state | Webhook | [ ] |
| C2 | subscription.updated → status change | Webhook | [ ] |
| C3 | subscription.deleted → billing state | Webhook | [ ] |
| C4 | Webhook idempotency | Webhook | [ ] |
| C5 | Webhook — невідомий provider | Webhook | [ ] |
| C6 | Webhook — відсутній signature | Webhook | [ ] |
| C7 | Webhook — неправильна signature | Webhook | [ ] |
| D1 | Купівля кредитного пакету — повний flow | One-Off Payments | [ ] |
| D2 | Купівля кредитів — accumulation | One-Off Payments | [ ] |
| D3 | Невалідний packCode | One-Off Payments | [ ] |
| D4 | One-off з активною підпискою | One-Off Payments | [ ] |
| E1 | Subscription disabled (feature flag) | Feature Flags | [ ] |
| E2 | One-off disabled (feature flag) | Feature Flags | [ ] |
| F1 | SubscriptionGuard — без підписки | Access Guard | [ ] |
| F2 | SubscriptionGuard — з підпискою | Access Guard | [ ] |
| F3 | SubscriptionGuard — без JWT | Access Guard | [ ] |
| G1 | Billing page — стан A (no subscription) | Billing Page UI | [ ] |
| G2 | Billing page — стан B (active) | Billing Page UI | [ ] |
| G3 | Billing page — стан C (canceling) | Billing Page UI | [ ] |
| G4 | Credits секція — баланс та пакети | Billing Page UI | [ ] |
| G5 | Loading state кнопок | Billing Page UI | [ ] |
| G6 | Error handling (network error) | Billing Page UI | [ ] |
| H1 | /billing — неавторизований | Route Protection | [ ] |
| H2 | /billing — авторизований | Route Protection | [ ] |
| H3 | /billing/success та /billing/cancel | Route Protection | [ ] |
| I1 | getMe — billing field після підписки | Billing State | [ ] |
| I2 | getMe — billing field без підписки | Billing State | [ ] |
| I3 | getMe — credits field після one-off | Billing State | [ ] |
| J1 | Billing page — Ukrainian | i18n | [ ] |
| J2 | Billing page — English | i18n | [ ] |
| J3 | Toast — payments errors | i18n | [ ] |
| K1 | Checkout — JWT required | Security | [ ] |
| K2 | Portal — JWT required | Security | [ ] |
| K3 | Webhook — без rate limiting | Security | [ ] |
| K4 | rawBody: true — не ламає інші endpoints | Security | [ ] |

**Total: 40 тестів**
