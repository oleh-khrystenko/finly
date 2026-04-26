# Webhook обробка

Файл: `apps/api/src/modules/payments/payments.service.ts` (handleWebhook)

## Загальний флоу

```
Stripe event
    │
    ▼
1. stripe.webhooks.constructEvent(rawBody, signature, secret)
    │ невалідний підпис → exception → 400
    │ невідомий event type → return null → 200
    │
    ▼
2. resolveUserId(event)
    │ не знайдено → warn log → return (200)
    │
    ▼
3. insertWebhookEvent (two-phase idempotency)
    │ вже applied → return (200)
    │ pending (retry) → продовжити обробку
    │
    ▼
4. processWebhookEvent
    │ subscription → atomic billing update
    │ one-off → addCredits
    │
    ▼
5. markWebhookEventApplied
    │ помилка на кроці 4 → rollbackPendingWebhookEvent
```

## Stripe events -> Canonical types

Файл: `apps/api/src/modules/payments/providers/stripe.service.ts` (handleWebhookPayload)

| Stripe Event | Умова | Canonical Type |
|-------------|-------|----------------|
| `checkout.session.completed` | `mode=subscription` | `CHECKOUT_COMPLETED` |
| `checkout.session.completed` | `mode=payment`, `payment_status=paid` | `ONE_OFF_PAYMENT_COMPLETED` |
| `checkout.session.async_payment_succeeded` | `mode=payment`, `payment_status=paid` | `ONE_OFF_PAYMENT_COMPLETED` |
| `customer.subscription.updated` | — | `SUBSCRIPTION_UPDATED` |
| `customer.subscription.deleted` | — | `SUBSCRIPTION_DELETED` |
| Будь-який інший | — | `null` (ігнорується) |

## Resolve userId

Файл: `apps/api/src/modules/payments/payments.service.ts` (resolveUserId)

Два шляхи:
1. `event.userId` — з metadata (checkout events мають `metadata.userId` та `client_reference_id`)
2. Lookup по `billing.providerSubscriptionId` — для subscription updated/deleted events (де metadata відсутня, а `event.raw.id` = subscription ID)

## Обробка по типу

### CHECKOUT_COMPLETED (subscription)

- Atomic update `user.billing` з повним набором полів: provider, providerCustomerId, providerSubscriptionId, planCode, currency, status, currentPeriodEnd, cancelAtPeriodEnd, hasActiveSubscription
- Out-of-order guard: оновлює тільки якщо `lastProviderEventAt` is null або `<= event.occurredAt`
- Two-phase MongoDB: Phase 1 (dot-notation для існуючого billing) -> Phase 2 (full set для billing=null)

### SUBSCRIPTION_UPDATED

- Оновлює: subscriptionStatus, providerSubscriptionStatus, currentPeriodEnd, cancelAtPeriodEnd, hasActiveSubscription
- Той самий atomic out-of-order guard

### SUBSCRIPTION_DELETED

- Встановлює: subscriptionStatus=CANCELED, hasActiveSubscription=false, providerSubscriptionStatus=canceled
- Той самий atomic out-of-order guard

### ONE_OFF_PAYMENT_COMPLETED

- Не оновлює billing state
- `usersService.addCredits(userId, creditsAmount)` — atomic `$inc` на `credits.balance`
- Якщо `creditsAmount` <= 0 або не число — warn log, skip

## Webhook always returns 200

Controller повертає `{ received: true }` для всіх успішних запитів. Stripe не отримає retry для вже оброблених або ігнорованих events. Exception при signature verification або DB error — propagates як 4xx/5xx, Stripe зробить retry.
