# Subscription Guard

Файл: `apps/api/src/common/guards/subscription.guard.ts`

## Призначення

Захищає endpoints що вимагають активної підписки. Перевіряє `user.billing?.hasActiveSubscription`.

## Реалізація

```typescript
@Injectable()
export class SubscriptionGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const user = request.user as UserDocument;
        if (!user || !user.billing?.hasActiveSubscription) {
            throw new ForbiddenException({
                code: RESPONSE_CODE.SUBSCRIPTION_REQUIRED,
                message: 'Subscription required',
            });
        }
        return true;
    }
}
```

## Використання

Комбінується з `JwtAuthGuard`:

```typescript
@UseGuards(JwtAuthGuard, SubscriptionGuard)
```

Повертає 403 з кодом `SUBSCRIPTION_REQUIRED`.

## Де застосовується

Наразі guard створений, але ще не застосований до конкретних endpoints — модулі reports та storage у стані skeleton.
