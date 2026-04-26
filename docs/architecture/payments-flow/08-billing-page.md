# Frontend — Billing Page

Файли:
- `apps/web/src/app/[locale]/(protected)/billing/page.tsx`
- `apps/web/src/app/[locale]/(protected)/billing/success/page.tsx`
- `apps/web/src/app/[locale]/(protected)/billing/cancel/page.tsx`
- `apps/web/src/app/[locale]/(protected)/billing/layout.tsx`
- `apps/web/src/shared/api/payments.ts`

## Billing Page

Protected route (AuthGuard). Дві незалежних секції, контрольованих feature flags:

### Subscription Section (PAYMENTS_SUBSCRIPTION_ENABLED)

**Стан: немає підписки** (`hasActiveSubscription !== true`)

- Заголовок, опис, назва плану
- Кнопка "Підписатись" → `createSubscriptionCheckout('monthly_usd')` → `window.location.assign(checkoutUrl)`

**Стан: є підписка** (`hasActiveSubscription === true`)

- Заголовок "Активна підписка"
- Статус: "Активна" або "Скасовується {дата}" (якщо `cancelAtPeriodEnd`)
- Plan code, дата наступного списання (якщо не cancelAtPeriodEnd)
- Попередження при cancelAtPeriodEnd
- Кнопка "Керувати підпискою" → `createPortalSession()` → `window.location.assign(portalUrl)` (Stripe Billing Portal)

### Credits Section (PAYMENTS_ONE_OFF_ENABLED)

- Заголовок, опис
- Поточний баланс кредитів: `user.credits.balance`
- Список пакетів з `CREDIT_PACK_CONFIG` (credits_5, credits_10, credits_20):
  - Для кожного — назва (кількість кредитів) + кнопка "Купити"
  - Клік → `createOneOffCheckout(packCode)` → `window.location.assign(checkoutUrl)`

### Loading state

`loadingAction` — рядок що відслідковує яка дія зараз виконується:
- `'subscribe'`, `'portal'`, `'oneoff_credits_5'` тощо
- Кнопка показує spinner, disabled для поточної дії

## Success Page

`/billing/success`

1. `getMe()` → оновлення Zustand store (щоб billing state актуалізувався)
2. Toast success
3. Redirect на `/billing`

Якщо `getMe()` впав — toast error, все одно redirect на `/billing`.

## Cancel Page

`/billing/cancel`

1. Toast info "Скасовано"
2. Redirect на `/billing`

## Frontend API functions

Файл: `apps/web/src/shared/api/payments.ts`

```typescript
createSubscriptionCheckout(planCode: string): Promise<{ checkoutUrl: string }>
createOneOffCheckout(packCode: CreditPackCode): Promise<{ checkoutUrl: string }>
createPortalSession(): Promise<{ portalUrl: string }>
```

Всі використовують `apiClient.post()` — автоматично додає access token через interceptor.

## Credits Badge (Header)

Credits balance також відображається в header як badge біля аватарки (widget header).
