# Типи та контракти

Файл: `packages/types/src/contracts/payments.ts`

## Enums

### PAYMENT_TYPE

```typescript
PAYMENT_TYPE = {
    SUBSCRIPTION: 'subscription',
    ONE_OFF: 'one_off',
}
```

### SUBSCRIPTION_STATUS

```typescript
SUBSCRIPTION_STATUS = {
    ACTIVE: 'ACTIVE',
    TRIALING: 'TRIALING',
    PAST_DUE: 'PAST_DUE',
    CANCELED: 'CANCELED',
    INCOMPLETE: 'INCOMPLETE',
    UNPAID: 'UNPAID',
    UNKNOWN: 'UNKNOWN',
}
```

### BILLING_EVENT_TYPE

```typescript
BILLING_EVENT_TYPE = {
    CHECKOUT_COMPLETED: 'CHECKOUT_COMPLETED',
    SUBSCRIPTION_UPDATED: 'SUBSCRIPTION_UPDATED',
    SUBSCRIPTION_DELETED: 'SUBSCRIPTION_DELETED',
    ONE_OFF_PAYMENT_COMPLETED: 'ONE_OFF_PAYMENT_COMPLETED',
}
```

### CREDIT_PACK_CONFIG

```typescript
CREDIT_PACK_CONFIG = {
    credits_5: { credits: 5 },
    credits_10: { credits: 10 },
    credits_20: { credits: 20 },
}
```

`CreditPackCode = 'credits_5' | 'credits_10' | 'credits_20'`

## Schemas

### CreateCheckoutSessionSchema

Discriminated union по `paymentType`:
- `subscription` → `planCode` обов'язковий
- `one_off` → `packCode` обов'язковий (enum з ключів CREDIT_PACK_CONFIG)

Zod `.refine()` валідує що відповідне поле присутнє.

### UserBillingSchema

Zod schema для `user.billing` subdocument. Всі поля відповідають Mongoose schema. Використовується для типізації frontend response.

### BillingWebhookEventSchema

Canonical model для webhook events:

| Поле | Тип | Опис |
|------|-----|------|
| type | BillingEventType | Canonical event type |
| providerEventId | string | Stripe event ID |
| occurredAt | Date | `stripeEvent.created * 1000` |
| userId | string | З metadata або resolveUserId |
| subscriptionStatus | SubscriptionStatus? | Для subscription events |
| currentPeriodEnd | Date? | Кінець періоду |
| cancelAtPeriodEnd | boolean? | Скасування в кінці періоду |
| creditsAmount | number? | Для one-off events |
| packCode | string? | Код пакету для one-off |
| raw | Record<string, unknown> | Оригінальний Stripe payload |

## Response codes (payments-related)

Файл: `packages/types/src/enums/response-code.ts`

| Code | Type | Опис |
|------|------|------|
| `CHECKOUT_SESSION_CREATED` | success | Checkout session створено |
| `PORTAL_SESSION_CREATED` | success | Portal session створено |
| `ALREADY_SUBSCRIBED` | error | Юзер вже має підписку |
| `SUBSCRIPTION_REQUIRED` | error | Потрібна підписка для доступу |
| `NO_BILLING_ACCOUNT` | error | Немає Stripe customer |
| `PAYMENT_TYPE_DISABLED` | error | Тип платежу вимкнений |
