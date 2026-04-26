# Архітектура

## Adapter Pattern

Платіжна система побудована на adapter pattern з DI injection token:

```
┌─────────────────────┐
│  PaymentsController  │
│  - checkout-session  │
│  - portal-session    │
│  - webhook/:provider │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│   PaymentsService   │
│  (orchestration,    │
│   idempotency,      │
│   billing state)    │
└──────────┬──────────┘
           │
┌──────────▼──────────────┐
│  IPaymentProvider       │
│  (interface + DI token) │
└──────────┬──────────────┘
           │
┌──────────▼──────────┐
│    StripeService     │
│  (implements above)  │
└─────────────────────┘
```

## Відповідальності

- **PaymentsController** — HTTP endpoints, валідація вхідних даних, guards
- **PaymentsService** — бізнес-логіка: checkout validation, feature flag checks, webhook orchestration (two-phase idempotency, resolveUserId, processEvent, billing update), portal session
- **IPaymentProvider** — інтерфейс провайдера: створення checkout/portal sessions, парсинг webhook payload
- **StripeService** — Stripe-специфічна реалізація: Stripe SDK, event mapping, signature verification

## Module Structure

Файл: `apps/api/src/modules/payments/payments.module.ts`

```
PaymentsModule
├── MongooseModule.forFeature(ProcessedWebhookEvent)
├── UsersModule (для addCredits, findById)
├── Providers:
│   ├── PaymentsService
│   ├── StripeService
│   └── paymentProviderProvider (DI factory: PAYMENT_PROVIDER → StripeService)
└── Exports: [PaymentsService]
```

DI token `PAYMENT_PROVIDER` (Symbol) резолвиться на `StripeService` через factory provider у `payment-provider.provider.ts`.
