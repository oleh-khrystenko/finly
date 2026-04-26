# Конфігурація (env vars)

Файл: `apps/api/src/config/env.ts`

## Required (crash if missing)

| Змінна | Опис |
|--------|------|
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Webhook endpoint signing secret |
| `STRIPE_PRICE_ID_SUBSCRIPTION` | Stripe Price ID для subscription plan |

## Required when one-off enabled

| Змінна | Опис |
|--------|------|
| `STRIPE_PRICE_ID_CREDITS_5` | Stripe Price ID для пакету 5 кредитів |
| `STRIPE_PRICE_ID_CREDITS_10` | Stripe Price ID для пакету 10 кредитів |
| `STRIPE_PRICE_ID_CREDITS_20` | Stripe Price ID для пакету 20 кредитів |

Ці змінні обов'язкові тільки коли `PAYMENTS_ONE_OFF_ENABLED=true`. При `false` мають fallback на порожній рядок.

## Optional (мають defaults)

| Змінна | Default | Опис |
|--------|---------|------|
| `BILLING_SUCCESS_URL` | `{WEB_URL}/billing/success` | URL після успішної оплати |
| `BILLING_CANCEL_URL` | `{WEB_URL}/billing/cancel` | URL після скасування checkout |
| `PAYMENTS_SUBSCRIPTION_ENABLED` | `'true'` | Feature flag для subscription |
| `PAYMENTS_ONE_OFF_ENABLED` | `'true'` | Feature flag для one-off |

## Frontend env vars

Файл: `apps/web/src/shared/config/env.ts`

| Змінна | Default | Опис |
|--------|---------|------|
| `NEXT_PUBLIC_PAYMENTS_SUBSCRIPTION_ENABLED` | `'true'` | Видимість subscription секції |
| `NEXT_PUBLIC_PAYMENTS_ONE_OFF_ENABLED` | `'true'` | Видимість credits секції |

## STRIPE_CREDIT_PACKS (computed)

Runtime об'єкт, що маппить `packCode` -> `{ priceId, credits }`. Заповнюється тільки коли `PAYMENTS_ONE_OFF_ENABLED=true`. Використовується в `PaymentsService.createCheckoutSession()` для визначення priceId по packCode.

## test-setup.ts

Файл: `apps/api/src/test-setup.ts`

Встановлює placeholder Stripe env vars (`sk_test_placeholder`, `whsec_test_placeholder`, `price_test_placeholder`) для unit test runs. Без цього fail-fast policy крашить тести при імпорті `env.ts`.
