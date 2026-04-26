# Checkout — підписка та кредити

Файл: `apps/api/src/modules/payments/payments.service.ts` (createCheckoutSession)

## Два типи платежів

Система підтримує два незалежних типи платежів, контрольованих feature flags:

### 1. Subscription (підписка)

- `paymentType: 'subscription'`
- `planCode: 'monthly_usd'` — єдиний план
- Stripe Checkout mode: `subscription`
- Price ID: `STRIPE_PRICE_ID_SUBSCRIPTION` (env var)
- **Валідація:** якщо `user.billing?.hasActiveSubscription === true` -> 409 ALREADY_SUBSCRIBED

### 2. One-off (кредитні пакети)

- `paymentType: 'one_off'`
- `packCode: 'credits_5' | 'credits_10' | 'credits_20'`
- Stripe Checkout mode: `payment`
- Price ID: з `STRIPE_CREDIT_PACKS[packCode].priceId` (env vars)
- **Валідація:** packCode повинен існувати в `STRIPE_CREDIT_PACKS`

## Конфігурація кредитних пакетів

Визначена в `packages/types/src/contracts/payments.ts`:

```typescript
CREDIT_PACK_CONFIG = {
    credits_5: { credits: 5 },
    credits_10: { credits: 10 },
    credits_20: { credits: 20 },
}
```

Runtime mapping packCode -> priceId в `apps/api/src/config/env.ts`:

```typescript
STRIPE_CREDIT_PACKS = {
    credits_5: { priceId: STRIPE_PRICE_ID_CREDITS_5, credits: 5 },
    credits_10: { priceId: STRIPE_PRICE_ID_CREDITS_10, credits: 10 },
    credits_20: { priceId: STRIPE_PRICE_ID_CREDITS_20, credits: 20 },
}
```

`STRIPE_CREDIT_PACKS` заповнюється тільки коли `PAYMENTS_ONE_OFF_ENABLED=true`. Інакше — порожній об'єкт.

## Stripe Checkout Session

Файл: `apps/api/src/modules/payments/providers/stripe.service.ts` (createCheckoutSession)

Параметри Stripe session:

| Параметр | Значення |
|----------|----------|
| mode | `subscription` або `payment` |
| customer | `providerCustomerId` (якщо є) |
| customer_email | `user.email` (якщо немає customer) |
| line_items | `[{ price: priceId, quantity: 1 }]` |
| metadata | `{ userId, planCode, credits }` |
| client_reference_id | `userId` |
| success_url | `BILLING_SUCCESS_URL` |
| cancel_url | `BILLING_CANCEL_URL` |

## Post-checkout redirect

Після оплати Stripe редіректить на:

- **Success:** `/billing/success` -> `getMe()` -> оновлення store -> toast success -> redirect `/billing`
- **Cancel:** `/billing/cancel` -> toast info -> redirect `/billing`
