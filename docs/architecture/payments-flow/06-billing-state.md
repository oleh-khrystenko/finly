# Billing State (User schema)

Файл: `apps/api/src/modules/users/schemas/user.schema.ts`

## user.billing subdocument

`billing` — nullable subdocument на User schema. `null` = юзер ніколи не платив.

| Поле | Тип | Опис |
|------|-----|------|
| provider | string \| null | `'stripe'` |
| providerCustomerId | string \| null | Stripe Customer ID |
| providerSubscriptionId | string \| null | Stripe Subscription ID |
| planCode | string \| null | `'monthly_usd'` |
| currency | string \| null | `'usd'` |
| subscriptionStatus | string \| null | Canonical: ACTIVE, TRIALING, PAST_DUE, CANCELED, INCOMPLETE, UNPAID, UNKNOWN |
| providerSubscriptionStatus | string \| null | Raw Stripe status string |
| currentPeriodEnd | Date \| null | Кінець поточного періоду |
| cancelAtPeriodEnd | boolean | Чи заплановано скасування |
| hasActiveSubscription | boolean | Denormalized: `status in [ACTIVE, TRIALING]` |
| lastProviderEventAt | Date \| null | Timestamp останнього обробленого event (для out-of-order detection) |

## Індекси

```javascript
UserSchema.index({ 'billing.providerCustomerId': 1 }, { sparse: true });
UserSchema.index({ 'billing.providerSubscriptionId': 1 }, { sparse: true });
```

## hasActiveSubscription

Denormalized boolean, оновлюється атомарно разом з `subscriptionStatus`:

```typescript
hasActiveSubscription = status === SUBSCRIPTION_STATUS.ACTIVE
                     || status === SUBSCRIPTION_STATUS.TRIALING;
```

Використовується в:
- `SubscriptionGuard` — для захисту платних endpoints
- Frontend billing page — для визначення UI стану (subscribe vs manage)

## Credits (user.credits)

Окремо від billing, не пов'язані з підпискою:

| Поле | Тип | Опис |
|------|-----|------|
| balance | number (int >= 0) | Кількість оплачених кредитів |
| freeReportUsed | boolean | Чи використаний безкоштовний звіт |

Operations:
- `addCredits(userId, amount)` — atomic `$inc` на `credits.balance`
- `deductCredit(userId)` — спроба paid credit ($gt: 0), fallback на free report
- `hasCredit(userId)` — balance > 0 OR !freeReportUsed

## Що повертає GET /api/users/me (billing)

Frontend отримує обмежений набір billing полів:

```typescript
billing: {
    hasActiveSubscription: boolean,
    planCode: string | null,
    subscriptionStatus: string | null,
    currentPeriodEnd: Date | null,
    cancelAtPeriodEnd: boolean,
} | null
```

`providerCustomerId`, `providerSubscriptionId`, `lastProviderEventAt` та інші internal поля не експонуються.

## Soft-delete

При soft-delete акаунту (30-day grace period) billing state зберігається. Restore акаунту повертає billing як є.
