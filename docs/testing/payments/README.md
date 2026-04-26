# Payments Testing: повне покриття payments flow тестами

## Контекст

Комплексне тестування всієї платіжної підсистеми: automated (unit + e2e) та manual E2E тести. Всі автоматизовані тести реалізовані та проходять.

Покриває всю payments підсистему: PaymentsService (checkout sub + one-off, portal, two-phase webhook idempotency, out-of-order protection, one-off credit flow), StripeService (adapter, event mapping, 4 event types), SubscriptionGuard, PaymentsController, frontend API client та billing page (subscription + credits sections).

## Документи

| Файл | Опис |
|------|------|
| [automated-tests.md](./automated-tests.md) | Опис покриття: unit тести + e2e (всі реалізовані) |
| [manual-test-plan.md](./manual-test-plan.md) | 40 покрокових сценаріїв для ручного тестування з чеклистами |

## Scope

### automated-tests.md

Опис покриття та структури автоматизованих тестів.

- **Backend unit тести:**
  - `payments.service.spec.ts` (40 тестів) — createCheckoutSession (sub + one-off + feature flags), createPortalSession, handleWebhook (two-phase idempotency, out-of-order atomic guard, billing state per 4 event types, userId resolution, rollback, applyOneOffPayment edge cases)
  - `payments.controller.spec.ts` (8 тестів) — 3 endpoints, raw body validation, signature check, provider validation
  - `stripe.service.spec.ts` — webhook parsing (4 Stripe event types → 4 canonical types), status mapping (9 statuses), checkout/portal session creation (sub + one-off modes)
  - `subscription.guard.spec.ts` — 6 сценаріїв, повне покриття SubscriptionGuard

- **Backend e2e тести:**
  - `payments.e2e-spec.ts` (29 тестів) — checkout (sub + one-off), portal, webhook, idempotency, out-of-order events, subscription lifecycle, feature flags, response format

- **Frontend unit тести:**
  - `payments.spec.ts` (9 тестів) — createSubscriptionCheckout, createOneOffCheckout, createPortalSession

### manual-test-plan.md

40 сценаріїв у 11 категоріях:

- **A. Subscription Checkout** — підписка, вже підписаний, cancel, declined card
- **B. Billing Portal** — керування підпискою, no billing account, cancellation
- **C. Webhook Handling** — checkout.completed, subscription.updated, subscription.deleted, idempotency, invalid provider/signature
- **D. One-Off Payments** — credit pack purchase, accumulation, invalid pack, one-off with active subscription
- **E. Feature Flags** — disabled subscription, disabled one-off
- **F. SubscriptionGuard** — доступ з/без підписки, 403 response format
- **G. Billing Page UI** — 3 subscription states + credits section + loading + error
- **H. Route Protection** — /billing protected, redirect
- **I. Billing State** — getMe response (billing + credits)
- **J. i18n** — Ukrainian/English localization
- **K. Security** — JWT, rate limiting bypass, rawBody

## Verification

1. `pnpm --filter @cyanship/types build` — types компілюються
2. `pnpm --filter api test` — всі backend unit тести pass
3. `pnpm --filter api test:e2e` — всі backend e2e тести pass
4. `pnpm --filter web test` — всі frontend unit тести pass
5. `pnpm build` — повний build без помилок
6. Manual: пройти весь чеклист з manual-test-plan.md (40 тестів)
