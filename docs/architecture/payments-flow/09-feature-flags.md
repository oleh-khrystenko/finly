# Feature Flags

## Два незалежних toggle

| Flag | Backend env | Frontend env | Default |
|------|------------|-------------|---------|
| Subscriptions | `PAYMENTS_SUBSCRIPTION_ENABLED` | `NEXT_PUBLIC_PAYMENTS_SUBSCRIPTION_ENABLED` | `'true'` |
| One-off (credits) | `PAYMENTS_ONE_OFF_ENABLED` | `NEXT_PUBLIC_PAYMENTS_ONE_OFF_ENABLED` | `'true'` |

## Правило

Хоча б один тип платежу повинен бути увімкнений. Перевірка при старті API:

```typescript
if (!PAYMENTS_SUBSCRIPTION_ENABLED && !PAYMENTS_ONE_OFF_ENABLED) {
    throw new Error('At least one payment type must be enabled');
}
```

## Backend поведінка

Файл: `apps/api/src/modules/payments/payments.service.ts`

- Якщо `paymentType: 'subscription'` і `PAYMENTS_SUBSCRIPTION_ENABLED=false` → 400 `PAYMENT_TYPE_DISABLED`
- Якщо `paymentType: 'one_off'` і `PAYMENTS_ONE_OFF_ENABLED=false` → 400 `PAYMENT_TYPE_DISABLED`

Коли `PAYMENTS_ONE_OFF_ENABLED=false`:
- `STRIPE_PRICE_CREDITS_*` env vars не обов'язкові (fallback на порожній рядок)
- `STRIPE_CREDIT_PACKS` = порожній об'єкт

## Frontend поведінка

Файл: `apps/web/src/shared/config/env.ts`

- `PAYMENTS_SUBSCRIPTION_ENABLED` контролює видимість секції підписки на billing page
- `PAYMENTS_ONE_OFF_ENABLED` контролює видимість секції кредитів на billing page
- Секції повністю не рендеряться якщо flag = false
