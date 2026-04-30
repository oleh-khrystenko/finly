# Finly

> **Product vision (finly.com.ua):** SaaS для українських ФОП та їх бухгалтерів — генерація платіжних QR-кодів і посилань за стандартом НБУ; у планах сховище документів з AI-тегуванням.
>
> **Поточний стан:** product flow ще не реалізовано. Репозиторій містить модульний monorepo-monolith на Next.js 16 + NestJS 11: API керує auth/session lifecycle, billing та AI chat, web споживає це через спільні Zod/TypeScript контракти. Документація нижче описує цей тех-фундамент, а не QR/document features.

## Tech Stack

| Layer | Technology | Version / Role |
|---|---|---|
| Core | TypeScript, Node.js | TS 5.9, Node 20 |
| Web | Next.js, React, next-intl, Zustand, Tailwind CSS | Next 16 App Router, locale segments, client auth/bootstrap, shared UI |
| API | NestJS, Passport, nestjs-zod | Nest 11, JWT + Google OAuth, global ZodValidationPipe |
| Data | MongoDB, Mongoose, Redis, ioredis | schema-first documents, runtime token/rate-limit state, reservations |
| Integrations | Stripe, Resend, Anthropic | billing, email, AI chat |
| Tooling | pnpm workspaces, Turborepo, Jest, Docker Compose | monorepo orchestration, unit/e2e tests, local/dev containers |

## Architecture Overview

Finly поділений на три головні зони: `apps/api`, `apps/web`, `packages/types`. API є system of record для auth, refresh rotation, billing, execution ledger, AI chat reservations й email delivery; web лишається thin Next.js shell з locale-aware routing, auth bootstrap, overlay registry та shared API clients. `packages/types` містить спільні Zod contracts, entities, enums, які використовують обидва apps. `ai` реалізований як повноцінний модуль, тоді як `reports` і `storage` поки що scaffolds без бізнес-флоу.

## Project Structure

```text
apps/
├── api/src/
│   ├── main.ts, app.module.ts
│   ├── config/          # env loader
│   ├── common/          # decorators, filters, guards, interceptors, redis
│   └── modules/         # auth, users, payments, email, ai, reports, storage
├── web/src/
│   ├── app/[locale]/    # root, auth, (protected), privacy, terms
│   ├── entities/        # user, navigation, brand
│   ├── features/        # auth, billing, profile, theme/lang
│   ├── widgets/         # header
│   └── shared/          # api, config, lib, seo, styles, ui
packages/
└── types/src/           # contracts, entities, enums, constants
docs/
└── conventions/         # source-of-truth rules
```

## Domain Model

### User
Файл: `apps/api/src/modules/users/schemas/user.schema.ts` | Zod: `packages/types/src/entities/user.ts`
- `profile`, `executions`, `billing` зберігаються як embedded subdocuments; billing shape одразу шариться у web через `UserBillingSchema`.
- Soft-delete трекається через `deletedAt`; recovery flow додатково використовує `accountDeletionRequestedAt` і `deletionReminderSentAt`.
- Є sparse indexes на `provider.id`, billing provider IDs і `executions.activeReservation.expiresAt`.

### ExecutionTransaction
Файл: `apps/api/src/modules/users/schemas/execution-transaction.schema.ts` | Contract: `packages/types/src/contracts/executions.ts`
- Це append-only ledger для execution credit/debit операцій з `balanceAfter` і необов'язковим `reservationId`.
- Unique sparse index на `reservationId` страхує commit reservation від дублювання.
- Dashboard history читається через індекс `userId + createdAt`.

### ProcessedWebhookEvent
Файл: `apps/api/src/modules/payments/schemas/processed-webhook-event.schema.ts`
- Idempotency ledger для Stripe webhook-ів із unique `(provider, providerEventId)`.
- Має двофазний статус `pending -> applied`; при handler failure pending-запис відкочується.
- Зберігає `occurredAt`, `userId`, `packCode` для replay-safe billing updates.

### OrphanedProviderCustomer
Файл: `apps/api/src/modules/payments/schemas/orphaned-provider-customer.schema.ts`
- Черга повторної очистки Stripe customer після збоїв під час billing reset.
- Unique `(provider, providerCustomerId)` не дає дублювати orphan retry items.
- Тримає `attempts` і `lastAttemptAt` для cron cleanup.

### ChatMessage
Файл: `apps/api/src/modules/ai/schemas/chat-message.schema.ts` | Contract: `packages/types/src/contracts/ai-chat.ts`
- AI transcript зберігається в окремій колекції `chat_messages`, по два записи на успішний exchange.
- Індекс `userId + createdAt` гарантує стабільне відтворення історії.
- Повідомлення вставляються всередині reservation commit transaction, а не окремим post-write.

## Module Dependency Map

- `AppModule` → `RedisModule`, `AuthModule`, `EmailModule`, `UsersModule`, `PaymentsModule`, `AiModule`, `ReportsModule`, `StorageModule`
- `AuthModule` ↔ `UsersModule` (`forwardRef`, circular dependency)
- `PaymentsModule` → `UsersModule` + `PAYMENT_PROVIDER` abstraction (`StripeService`)
- `AiModule` → `UsersModule` + `AI_PROVIDER` abstraction (`AnthropicService`)
- `EmailModule` є `@Global()`, тому email sending інжектиться в інші модулі без локального `imports`
- `app/[locale]/layout.tsx` → `Providers` + `NextIntlClientProvider` + `AuthInitializer` + `Overlays`
- `app/[locale]/(protected)/layout.tsx` → `Header` + `AuthGuard`
- `shared/api/client.ts` → axios interceptors + refresh dedupe + `authEvents`; `entities/user/authStore.ts` підписується на подію й володіє session state
- `app/overlays.tsx` динамічно монтує overlay components — єдина точка mount-у global overlays

## Key Patterns

### Створення endpoint
Controller + guard + DTO wrapper + service; відповідь іде через `{ data: ... }` envelope. Приклади: `apps/api/src/modules/auth/auth.controller.ts`, `apps/api/src/modules/users/users.controller.ts`, `apps/api/src/modules/payments/payments.controller.ts`, `apps/api/src/modules/ai/ai.controller.ts`.

### Валідація
Zod schemas живуть у `packages/types/src/contracts/*`, після чого Nest DTO обгортають їх через `createZodDto()`. Приклади: `apps/api/src/modules/**/dto/*.ts`.

### Auth/session lifecycle
Access JWT зберігається лише in-memory у web (`apps/web/src/shared/api/client.ts`), refresh JWT живе в `bid_refresh` httpOnly cookie, rotation/rate limits/magic links трекаються Redis-ключами в `apps/api/src/modules/auth/auth.service.ts`. Bootstrap сесії робить `apps/web/src/features/auth/AuthInitializer.tsx`, а session-loss між слоями передається через `apps/web/src/shared/lib/authEvents.ts`.

### Onboarding gate
`apps/api/src/common/interceptors/onboarding.interceptor.ts` глобально блокує authenticated requests, якщо profile onboarding не завершений, якщо endpoint не позначений `@SkipOnboarding()`. Web дублює це UX-рівнем через `apps/web/src/features/auth/AuthGuard.tsx`, який редиректить на `/profile?mode=new`.

### Billing/webhook processing
Payments йдуть через provider abstraction; Stripe webhook-и потребують Nest `rawBody`, після чого `PaymentsService` вставляє `ProcessedWebhookEvent` як `pending`, застосовує бізнес-логіку і тільки тоді маркує його `applied`. Subscription ordering захищається через `billing.lastProviderEventAt`. Приклади: `apps/api/src/modules/payments/payments.service.ts`, `apps/api/src/modules/payments/providers/stripe.service.ts`.

### AI chat reservations
`POST /api/ai/chat` працює як SSE: API спочатку резервує executions під вартість запиту, потім стрімить відповіді провайдера, а успішний exchange комітить transcript і ledger entry транзакційно через `UsersService.commitReservation()`. Файли: `apps/api/src/modules/ai/ai.controller.ts`, `apps/api/src/modules/ai/ai.service.ts`, `apps/api/src/modules/users/users.service.ts`.

### Overlay architecture
Overlay state живе у in-slice Zustand stores, сам UI рендериться через `shared/ui` primitives, а глобальний mount відбувається один раз у `apps/web/src/app/overlays.tsx`. Правило: `docs/conventions/overlays.md`.

### Error handling and i18n mapping
Backend повертає machine-readable `code` через `apps/api/src/common/filters/all-exceptions.filter.ts`; frontend мапить цей код на locale keys через `apps/web/src/shared/api/mapApiCode.ts` і не повинен показувати backend `message` користувачу. Правило: `docs/conventions/i18n.md`.

## API Overview

Глобальний prefix: `/api`.

**AppController** (`apps/api/src/app.controller.ts`)
- `GET /api` — public — hello probe
- `GET /api/health` — public — health snapshot

**AuthController** (`apps/api/src/modules/auth/auth.controller.ts`)
- `GET /api/auth/google` — `AuthGuard('google')` + `SkipOnboarding` — start Google OAuth
- `GET /api/auth/google/callback` — `AuthGuard('google')` + `SkipOnboarding` — set refresh cookie, redirect to web callback
- `POST /api/auth/check-email` — public — detect account / password availability
- `POST /api/auth/login/password` — public — password login + token pair
- `POST /api/auth/magic-link/send` — public — send login/reset magic link
- `POST /api/auth/magic-link/verify` — public — consume magic link
- `POST /api/auth/password/reset` — public — reset password by token
- `POST /api/auth/password/set` — `JwtActiveGuard` + `SkipOnboarding` — set initial password
- `POST /api/auth/password/change` — `JwtActiveGuard` + `SkipOnboarding` — rotate password and session
- `POST /api/auth/password/verify` — `JwtActiveGuard` + `SkipOnboarding` — confirm password for sensitive action
- `POST /api/auth/refresh` — cookie-based — rotate refresh token
- `POST /api/auth/logout` — cookie-based — revoke refresh token best-effort

**UsersController** (`apps/api/src/modules/users/users.controller.ts`)
- `GET /api/users/me` — `JwtActiveGuard` + `SkipOnboarding` — current profile, billing, AI state
- `PATCH /api/users/me` — `JwtActiveGuard` + `SkipOnboarding` — update profile fields
- `PATCH /api/users/me/lang` — `JwtActiveGuard` + `SkipOnboarding` — change preferred language
- `POST /api/users/me/accept-terms` — `JwtActiveGuard` + `SkipOnboarding` — persist terms version
- `POST /api/users/me/executions/spend` — `JwtActiveGuard` — debit execution balance
- `GET /api/users/me/executions/transactions` — `JwtActiveGuard` — paginated execution ledger
- `POST /api/users/account/delete` — `JwtActiveGuard` + `SkipOnboarding` — choose password vs magic-link deletion path
- `POST /api/users/account/delete/confirm` — `JwtActiveGuard` + `SkipOnboarding` — soft-delete with password confirmation
- `POST /api/users/account/restore` — `JwtAuthGuard` — restore soft-deleted account

**PaymentsController** (`apps/api/src/modules/payments/payments.controller.ts`)
- `GET /api/payments/catalog` — public + `SkipThrottle` + `SkipOnboarding` — public pricing/catalog payload
- `POST /api/payments/checkout-session` — `JwtActiveGuard` — create Stripe checkout session
- `POST /api/payments/portal-session` — `JwtActiveGuard` — create Stripe billing portal session
- `POST /api/payments/reset` — `JwtActiveGuard` — clear billing state and execution history
- `POST /api/payments/webhook/:provider` — public + `SkipThrottle` — ingest provider webhook with raw body

**AiController** (`apps/api/src/modules/ai/ai.controller.ts`)
- `POST /api/ai/chat` — `JwtActiveGuard` + `AiRateLimitGuard` — SSE chat stream
- `GET /api/ai/chat/history` — `JwtActiveGuard` — load chat transcript
- `DELETE /api/ai/chat/history` — `JwtActiveGuard` — clear chat transcript

**Reports / Storage**
- `apps/api/src/modules/reports/reports.controller.ts` exists but has no route methods yet
- `apps/api/src/modules/storage/` exports a service only; controller/business flow is absent

## Configuration & Environment

**Loaders and source files**
- API fail-fast loader: `apps/api/src/config/env.ts`
- Web fail-fast loader: `apps/web/src/shared/config/env.ts`
- Next build/proxy config: `apps/web/next.config.ts`
- Shared sample: `.env.example`

**API env: required**
- Runtime/data: `NODE_ENV`, `PORT`, `WEB_URL`, `MONGODB_URI`, `REDIS_URL`
- Auth: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- OAuth/email: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- Payments: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENTS_SUBSCRIPTION_ENABLED`, `PAYMENTS_ONE_OFF_ENABLED`
- Auth tuning: `AUTH_PASSWORD_MIN_LENGTH`, `AUTH_LOCKOUT_THRESHOLDS`, `AUTH_LOGIN_ATTEMPTS_TTL_MIN`, `AUTH_MAGIC_LINK_TTL_MIN`, `AUTH_MAGIC_LINK_RATE_LIMIT`, `AUTH_MAGIC_LINK_RATE_WINDOW_MIN`, `AUTH_MAGIC_LINK_DEDUP_SEC`, `ACCOUNT_DELETION_GRACE_DAYS`
- AI: `ANTHROPIC_API_KEY`, `AI_CHAT_MAX_TOKENS`, `AI_CHAT_IP_LIMIT`

**API env invariants**
- `PAYMENTS_SUBSCRIPTION_ENABLED` і `PAYMENTS_ONE_OFF_ENABLED` є required booleans; якщо обидва `false`, API падає на старті
- `GOOGLE_CALLBACK_URL` має вказувати на web-origin `/api/auth/google/callback`, щоб OAuth callback проходив через Next rewrite і refresh cookie лишався на web domain
- `AUTH_LOCKOUT_THRESHOLDS` парситься з рядка виду `5:1,10:5,20:15`

**Web env: required**
- Public base/API: `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_API_URL`
- Payments flags: `NEXT_PUBLIC_PAYMENTS_SUBSCRIPTION_ENABLED`, `NEXT_PUBLIC_PAYMENTS_ONE_OFF_ENABLED`
- Storage: `NEXT_PUBLIC_STORAGE_HOSTNAME`

**Web env: optional**
- `API_INTERNAL_URL` — server-side rewrite target для `/api`; rewrite додається лише коли змінна задана

**Infra / orchestration**
- `docker-compose.dev.yml` піднімає `redis`, `api`, `web`; MongoDB у compose немає, він приходить з зовнішнього `MONGODB_URI`
- `docker-compose.yml` також очікує зовнішній MongoDB і передає env у build/runtime
- Dev compose збирає `@finly/types` перед запуском apps

**Policy**
- Rule source: `docs/conventions/fail-fast.md`
- Для будь-якої нової env var потрібно синхронно оновити `env.ts`, `.env.example`, `.env`; тестовий виняток з `??=` дозволений лише в `apps/api/src/test-setup.ts`
- У web `NEXT_PUBLIC_*` vars мають читатися через прямий `process.env.VAR`, а не динамічний lookup, щоб Next зміг inline-ити їх у client bundle

## Common Commands

- `pnpm dev` — run all workspace dev tasks через Turbo
- `pnpm build` — build all apps/packages
- `pnpm lint` — lint workspace
- `pnpm format` — run Prettier over repo
- `pnpm test` — run workspace tests
- `pnpm --filter api dev|build|test|test:e2e|test:cov|email:dev` — API-only workflow
- `pnpm --filter web dev|build|test|lint` — web-only workflow
- `pnpm --filter @finly/types build|dev` — build/watch shared contracts
- `docker compose -f docker-compose.dev.yml up --build` — local dev stack with Redis + apps
- `docker compose up --build -d` — production-like container stack

## Testing Strategy

- API unit specs живуть поруч із кодом у `apps/api/src/**/*.spec.ts`
- API e2e лежать у `apps/api/test/*.e2e-spec.ts`; вони використовують `MongoMemoryServer`, mocked Redis/provider dependencies і окремий `jest-e2e.json`
- Web використовує Jest + jsdom; specs лежать поруч із source, особливо навколо middleware, auth bootstrap/guards, shared API clients, overlay stores

<!-- MANUAL:START -->
# Rules

- Before making ANY code changes, read the relevant module's files to understand current implementation
- Always check prisma/schema.prisma before modifying data layer
- Always check existing patterns in similar modules before creating new ones

## Project Conventions (MANDATORY)

All AI agents MUST read and follow rules in `docs/conventions/`:

- **[Tone & Style](docs/conventions/tone.md)** — tone and style for all user-facing messages (toasts, errors, confirmations)
- **[Fail Fast](docs/conventions/fail-fast.md)** — required env vars policy, no silent fallbacks

Full index: [docs/conventions/README.md](docs/conventions/README.md)
  <!-- MANUAL:END -->

## Rules & Conventions

- Source of truth for repo-wide rules: `docs/conventions/README.md`
- Перед змінами у user-facing copy, env/config, language sync, modular boundaries, overlays або shared UI перечитуй відповідні rules: `tone.md`, `fail-fast.md`, `i18n.md`, `modular-boundaries.md`, `overlays.md`, `ui-primitives.md`, `design-tokens.md`
- Boundary rules реально enforce-яться в `apps/web/eslint.config.mjs` і `apps/api/eslint.config.mjs`: немає глобального `src/stores/`, `shared/` не імпортує вищі FSD layers
- Runtime data layer зараз повністю на Mongoose schemas під `apps/api/src/modules/**/schemas`; `prisma/schema.prisma` у репозиторії відсутній

## Known Complexities

- `apps/web/src/middleware.ts` приймає рішення про auth переважно за наявністю cookies `bid_refresh` і `bid_account_deleted`, а не за валідністю токена; stale cookies можуть дати хибний redirect до того, як client flow очистить state
- Soft-deleted recovery розщеплений між backend redirect `?account_deleted=true` (`apps/api/src/modules/auth/auth.controller.ts`) і frontend cookie `bid_account_deleted` (`apps/web/src/app/[locale]/auth/callback/page.tsx`, `apps/web/src/middleware.ts`); якщо змінити лише одну сторону, restore flow зламається
- `apps/web/src/shared/api/mapApiCode.ts` будує ключі виду `errors.generic.<code>`, але сам не робить runtime fallback до `errors.generic.unknown`; caller або словники мають це покривати
- AI chat списує запит як non-refundable після першого успішно отриманого токена; abort до першого токена повертається одразу або через `apps/api/src/modules/users/reservation-reconcile.service.ts` кожні 5 хвилин
- `apps/api/src/modules/payments/payments.service.ts` при billing reset спочатку чистить Mongo billing state і execution history, а cleanup Stripe customer у разі збою відкладає в `OrphanedProviderCustomer` для cron retry
- `@finly/types` резолвиться через `dist` entry; при app-only запуску з чистого checkout часто треба спочатку зібрати або watch-ити `packages/types`
- `apps/api/src/modules/reports/` і `apps/api/src/modules/storage/` залишаються scaffold-модулями без реального route/business flow
