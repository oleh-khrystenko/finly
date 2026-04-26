# Idempotency та out-of-order

Файл: `apps/api/src/modules/payments/payments.service.ts`

## Two-phase idempotency

Використовується колекція `ProcessedWebhookEvent` з unique index `(provider, providerEventId)`.

### Phase 1: Insert as pending

```
insertWebhookEvent(provider, event, userId)
```

1. Спроба `create()` з `status: 'pending'`
2. Якщо успішно — `'new'`, продовжити обробку
3. Якщо duplicate key (MongoDB error 11000):
   - Знаходить існуючий запис
   - Якщо `status: 'applied'` — `'applied'`, повернути 200 (вже оброблено)
   - Якщо `status: 'pending'` — `'retry'`, продовжити обробку (попередня спроба впала)

### Phase 2: Process event

Виконується бізнес-логіка (billing update або addCredits).

### Phase 3: Mark applied або rollback

- **Успіх:** `markWebhookEventApplied()` — `updateOne({ status: 'applied' })`
- **Помилка:** `rollbackPendingWebhookEvent()` — `deleteOne({ status: 'pending' })` — дозволяє Stripe retry

Rollback обгорнутий у try/catch — якщо rollback теж впав, логується error, але не кидає exception.

## ProcessedWebhookEvent Schema

Файл: `apps/api/src/modules/payments/schemas/processed-webhook-event.schema.ts`

| Поле | Тип | Опис |
|------|-----|------|
| provider | string | `'stripe'` |
| providerEventId | string | Stripe event ID |
| receivedAt | Date | Коли webhook отримано |
| occurredAt | Date | `stripeEvent.created` (Unix epoch * 1000) |
| type | string | BILLING_EVENT_TYPE |
| userId | string \| null | ID користувача |
| packCode | string \| null | Для one-off payments |
| status | `'pending'` \| `'applied'` | Two-phase state |

**Unique index:** `{ provider: 1, providerEventId: 1 }` — основа idempotency.

**timestamps: false** — використовує custom `receivedAt`/`occurredAt`.

## Out-of-order handling (subscription events)

Subscription billing update використовує atomic MongoDB query з guard:

```javascript
{
    _id: userId,
    billing: { $ne: null },
    $or: [
        { 'billing.lastProviderEventAt': null },
        { 'billing.lastProviderEventAt': { $lte: event.occurredAt } },
    ],
}
```

- Оновлює тільки якщо `lastProviderEventAt` is null або менше/рівне `occurredAt` поточного event
- Атомарно — немає race condition між двома concurrent webhook requests
- `occurredAt` = `stripeEvent.created` (Stripe timestamp, не час отримання)

### Two-phase MongoDB update

MongoDB не може використовувати dot-notation `$set` на полі що явно null. Тому:

1. **Phase 1:** dot-notation update для існуючого billing object (`billing: { $ne: null }`)
2. **Phase 2:** якщо Phase 1 не знайшов документ — спроба full subdocument set для `billing: null` (перший billing event)
3. Якщо обидві фази не знайшли — event stale або orphan, skip

## Safety timeout

`WEBHOOK_MONGO_TIMEOUT_MS = 10000` — maxTimeMS для всіх MongoDB операцій у webhook path. Запобігає зависанню webhook handler.
