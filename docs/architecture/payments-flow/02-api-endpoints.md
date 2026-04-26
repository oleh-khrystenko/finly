# API Endpoints

Файл: `apps/api/src/modules/payments/payments.controller.ts`

Prefix: `/api/payments`

| Method | Path | Guard | Опис |
|--------|------|-------|------|
| POST | `/api/payments/checkout-session` | JwtActiveGuard | Створення Stripe Checkout session (subscription або one-off) |
| POST | `/api/payments/portal-session` | JwtActiveGuard | Створення Stripe Billing Portal session |
| POST | `/api/payments/webhook/:provider` | SkipThrottle | Прийом webhook-ів від Stripe |

## POST /api/payments/checkout-session

**Request body** (discriminated union по `paymentType`):

```typescript
// Subscription
{ paymentType: 'subscription', planCode: 'monthly_usd' }

// One-off
{ paymentType: 'one_off', packCode: 'credits_5' | 'credits_10' | 'credits_20' }
```

**Валідація:** `CreateCheckoutSessionSchema` (Zod) — `planCode` обов'язковий для subscription, `packCode` обов'язковий для one_off.

**Response:** `{ data: { checkoutUrl: string } }`

**Помилки:**
- 400 `PAYMENT_TYPE_DISABLED` — тип платежу вимкнений через feature flag
- 409 `ALREADY_SUBSCRIBED` — юзер вже має активну підписку (тільки для subscription)
- 400 `Invalid packCode` — невалідний packCode

## POST /api/payments/portal-session

**Request body:** порожній (userId з JWT)

**Response:** `{ data: { portalUrl: string } }`

**Помилки:**
- 400 `NO_BILLING_ACCOUNT` — юзер не має `billing.providerCustomerId`

## POST /api/payments/webhook/:provider

**Підтримувані providers:** `stripe`

**Headers:** `stripe-signature` (обов'язковий)

**Body:** Raw body (Buffer) — потребує `rawBody: true` в `NestFactory.create()`

**Response:** `{ received: true }` (завжди 200 для успішно розпарсених events)

**Помилки:**
- 400 — unsupported provider, missing signature, missing raw body
- Stripe signature verification error — propagates як exception
