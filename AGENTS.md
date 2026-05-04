# Finly

> SaaS для українських ФОП та бухгалтерів: кабінет генерує публічні платіжні сторінки, QR-коди й NBU payload-links; майбутня фаза — документи з AI-тегуванням.

## Tech Stack

| Layer | Technology | Version / Role |
|---|---|---|
| Core | TypeScript, Node.js, pnpm, Turborepo | TS 5.9, Node 20, pnpm workspaces |
| Web | Next.js, React, Zustand, Tailwind CSS, next-themes | Next 16 App Router, React 19, FSD layers, single-locale UI |
| API | NestJS, Passport, nestjs-zod, @nestjs/schedule/throttler | Nest 11, JWT + Google OAuth, global ZodValidationPipe |
| Data | MongoDB, Mongoose, Redis, ioredis | schema-first documents, refresh/session/rate-limit state, reservations |
| Product Engines | @finly/types, qrcode, sharp | Zod contracts, NBU payload 002/003, PNG QR rendering |
| Integrations | Stripe, Resend, Anthropic, Cloudflare R2 | billing, email, AI chat, avatar media storage |
| Testing | Jest, Supertest, MongoMemoryServer, jsdom | API unit/e2e, web component/unit tests, shared contract tests |

## Architecture Overview

Finly — модульний monorepo-monolith із трьома основними частинами: `apps/api`, `apps/web`, `packages/types`. API є system of record для auth/session lifecycle, users, businesses, payments, executions ledger, AI reservations, QR rendering, avatar storage та email delivery. Web — тонкий Next App Router shell із FSD layers, client auth bootstrap, global overlay registry і host-aware routing для public payment domain. `packages/types` є спільним джерелом Zod contracts, entities, enums, validation і NBU QR payload generation. Business/public QR flow реалізований; invoices поки schema-only; reports і document storage залишаються scaffolds.

## Project Structure

```text
apps/
├── api/src/
│   ├── main.ts, app.module.ts
│   ├── config/          # fail-fast env
│   ├── common/          # guards, filters, redis
│   └── modules/         # auth, users, businesses, qr
├── api/scripts/         # one-shot migrations
├── web/src/
│   ├── app/             # root, auth, protected
│   ├── entities/        # user, navigation, brand
│   ├── features/        # auth, profile, business
│   ├── widgets/         # header
│   └── shared/          # api, config, ui
packages/
└── types/src/           # contracts, entities, qr
docs/
├── conventions/         # mandatory rules
└── product/             # working drafts
```

## Domain Model

### User
Файл: `apps/api/src/modules/users/schemas/user.schema.ts` | Zod: `packages/types/src/entities/user.ts`
- `profile`, `executions` і `billing` зберігаються як embedded subdocuments; `worksAsBookkeeper` — account capability, не role.
- Soft-delete трекається через `deletedAt`; recovery/reminder flow також залежить від `accountDeletionRequestedAt` і `deletionReminderSentAt`.
- Sparse indexes покривають Google provider id, billing provider IDs і `executions.activeReservation.expiresAt`.

### ExecutionTransaction
Файл: `apps/api/src/modules/users/schemas/execution-transaction.schema.ts` | Contract: `packages/types/src/contracts/executions.ts`
- Append-only ledger для credit/debit операцій із `balanceAfter` і необов'язковим `reservationId`.
- Unique sparse index на `reservationId` захищає reservation commit від дублювання.
- History/dashboard читають через індекс `userId + createdAt`.

### Business
Файл: `apps/api/src/modules/businesses/schemas/business.schema.ts` | Zod: `packages/types/src/entities/business.ts`
- Постійна public payment entity з `ownerId | null`, `managers`, requisites, tax settings, accepted banks і SEO opt-in.
- `slug` зберігає регістр для display; `slugLower` є unique і використовується для lookup.
- Ownerless business валідний лише з manager-ом; coupled VAT/tax rules живуть у shared Zod і service checks.

### Invoice
Файл: `apps/api/src/modules/invoices/schemas/invoice.schema.ts` | Zod: `packages/types/src/entities/invoice.ts`
- One-off payment link під конкретний business; суми зберігаються в копійках, purpose/expiry можуть бути override.
- Compound unique index на `(businessId, slug)`; MVP навмисно не має payment tracking fields.
- `InvoicesModule` лише реєструє й експортує schema; controller/service flow ще немає.

### ProcessedWebhookEvent
Файл: `apps/api/src/modules/payments/schemas/processed-webhook-event.schema.ts`
- Idempotency ledger для Stripe webhook-ів із unique `(provider, providerEventId)`.
- Two-phase статус `pending -> applied`; при handler failure pending-запис відкочується.
- Зберігає `occurredAt`, `userId`, `packCode` для replay-safe billing updates.

### OrphanedProviderCustomer
Файл: `apps/api/src/modules/payments/schemas/orphaned-provider-customer.schema.ts`
- Retry queue для provider customer cleanup після billing reset failures.
- Unique `(provider, providerCustomerId)` не дає дублювати cleanup jobs.
- Daily cron припиняє retries після max attempts у `PaymentsCleanupService`.

### ChatMessage
Файл: `apps/api/src/modules/ai/schemas/chat-message.schema.ts` | Contract: `packages/types/src/contracts/ai-chat.ts`
- AI transcript живе в окремій колекції `chat_messages`, не всередині user document.
- Stable replay використовує ordering `userId + createdAt`.
- User/assistant rows вставляються всередині reservation commit transaction.

## Module Dependency Map

- `AppModule` → `ConfigModule`, `ThrottlerModule`, `ScheduleModule`, `MongooseModule`, `RedisModule`, усі feature modules
- `AuthModule` ↔ `UsersModule` (`forwardRef`); `AuthModule` також імпортує `StorageModule` для Google avatar re-upload
- `UsersModule` експортує `UsersService` і свій `MongooseModule` models
- `BusinessesModule` → `QrModule` + `UsersModule`; експортує `BusinessesService` і Business model для майбутніх consumers
- `InvoicesModule` реєструє тільки `Invoice` model і експортує `MongooseModule`
- `PaymentsModule` → `UsersModule` + `PAYMENT_PROVIDER` abstraction (`StripeService`)
- `StorageModule` → `UsersModule` + `STORAGE_PROVIDER` abstraction (`CloudflareR2Service`)
- `AiModule` → `UsersModule` + `AI_PROVIDER` abstraction (`AnthropicService`)
- `EmailModule` є `@Global()`, тому email sending інжектиться без локальних imports
- Web root layout → `Providers` + `AuthInitializer` + `Overlays`; protected layout → `Header` + `AuthGuard`
- `shared/api/client.ts` публікує `authEvents`; `entities/user/authStore.ts` володіє session state
- `middleware.ts` відповідає за host-aware public/cabinet routing до auth redirects

## Key Patterns

### Створення endpoint
Controller + guard/decorator + DTO + service; JSON responses ідуть через `{ data: ... }` envelope, крім Stripe webhooks і PNG QR responses. Приклади: `apps/api/src/modules/businesses/businesses.controller.ts`, `apps/api/src/modules/storage/storage.controller.ts`.

### Валідація
Write contracts живуть у `packages/types/src/contracts/*`, API DTOs обгортають їх через `createZodDto()`. Entity-level invariants живуть у `packages/types/src/entities/*`; Mongoose schemas тримають переважно структурні правила.

### Auth/session lifecycle
Access JWT зберігається тільки in-memory (`apps/web/src/shared/api/client.ts`); refresh JWT живе в `bid_refresh`; Redis тримає refresh family, rotation state, lockouts і magic links (`apps/api/src/modules/auth/auth.service.ts`).

### Onboarding gate
Global `apps/api/src/common/interceptors/onboarding.interceptor.ts` блокує authenticated requests, доки profile onboarding не завершено, якщо endpoint не має `@SkipOnboarding()`. Web дублює UX у `apps/web/src/features/auth/AuthGuard.tsx`.

### Business ownership and slug
`worksAsBookkeeper` визначає `ownerId/managers` на create-time; подальший toggle змінює видимість, не ownership. Slug normalization явна в `BusinessesService`; migration: `apps/api/scripts/migrations/2026-05-03-businesses-slug-lower.ts`.

### Public payment host
Public zone — `pay.finly.com.ua/{slug}`, internal rewrite — `app/host-pay/[slug]`; cabinet routes не addressable з pay host. Файли: `apps/web/src/middleware.ts`, `apps/web/src/app/host-pay/[slug]/page.tsx`, `apps/web/src/shared/config/publicHosts.ts`.

### Public business API
`PublicBusinessesController` no-auth і CDN-cacheable; JSON whitelist проходить через `PublicBusinessSchema`, QR PNG endpoints живуть тут. Cabinet реюзає public QR URLs замість auth-only QR endpoints.

### QR/NBU generation
Pure payload builders живуть у `packages/types/src/qr/*`; Node PNG rendering і logo composition — у `apps/api/src/modules/qr/*`. `QrService.renderForUrl()` і `renderForNbuPayload()` навмисно розділені.

### Billing/webhook processing
Payments ідуть через provider abstraction; Stripe webhook потребує Nest `rawBody`. `PaymentsService` створює `ProcessedWebhookEvent` як `pending`, застосовує логіку і маркує `applied`; subscription ordering захищає `billing.lastProviderEventAt`.

### AI chat reservations
`POST /api/ai/chat` резервує executions до SSE streaming; успішний exchange transactionally commit-ить ledger + transcript через `UsersService.commitReservation()`. Expired active reservations reconcile-яться кожні 5 хвилин.

### Avatar storage
Avatar upload використовує API-issued R2 presigned PUT URLs; commit перевіряє file key shape, namespace, metadata, MIME і size перед binding public URL. Файли: `apps/api/src/modules/storage/storage.service.ts`, `packages/types/src/contracts/storage.ts`, `packages/types/src/constants/storage.ts`.

### Overlay architecture
Overlay state живе в in-slice Zustand stores; global mount тільки в `apps/web/src/app/overlays.tsx`. Rule source: `docs/conventions/overlays.md`.

### Error and copy mapping
Backend повертає machine-readable `error.code` через `apps/api/src/common/filters/all-exceptions.filter.ts`; frontend мапить codes на українські рядки в `apps/web/src/shared/api/mapApiCode.ts`. Tone rules: `docs/conventions/tone.md`.

### Frontend boundaries and UI
Web дотримується FSD `shared -> entities -> features -> widgets -> app`; shared UI primitives обов'язкові поза `shared/ui`. Rule sources: `docs/conventions/modular-boundaries.md`, `docs/conventions/ui-primitives.md`, `docs/conventions/design-tokens.md`, `docs/conventions/responsive.md`.

## API Overview

Global prefix: `/api`. Global guards/interceptors: `ThrottlerGuard`, `OnboardingInterceptor`.

**AppController** (`apps/api/src/app.controller.ts`)
- `GET /api` — public — hello probe
- `GET /api/health` — public — health snapshot

**AuthController** (`apps/api/src/modules/auth/auth.controller.ts`)
- `GET /api/auth/google` — `AuthGuard('google')` + `SkipOnboarding` — start OAuth
- `GET /api/auth/google/callback` — `AuthGuard('google')` + `SkipOnboarding` — set cookie, redirect
- `POST /api/auth/check-email` — public — password availability
- `POST /api/auth/login/password` — public — password login
- `POST /api/auth/magic-link/send` — public — send login/reset link
- `POST /api/auth/magic-link/verify` — public — consume magic link
- `POST /api/auth/password/reset` — public — reset by token
- `POST /api/auth/password/set` — `JwtActiveGuard` + `SkipOnboarding` — initial password
- `POST /api/auth/password/change` — `JwtActiveGuard` + `SkipOnboarding` — rotate password/session
- `POST /api/auth/password/verify` — `JwtActiveGuard` + `SkipOnboarding` — sensitive action check
- `POST /api/auth/refresh` — cookie-based — rotate refresh
- `POST /api/auth/logout` — cookie-based — revoke refresh

**UsersController** (`apps/api/src/modules/users/users.controller.ts`)
- `GET /api/users/me` — `JwtActiveGuard` + `SkipOnboarding` — current user
- `PATCH /api/users/me` — `JwtActiveGuard` + `SkipOnboarding` — profile/bookkeeper update
- `POST /api/users/me/accept-terms` — `JwtActiveGuard` + `SkipOnboarding` — terms version
- `POST /api/users/me/executions/spend` — `JwtActiveGuard` — debit executions
- `GET /api/users/me/executions/transactions` — `JwtActiveGuard` — ledger page
- `POST /api/users/account/delete` — `JwtActiveGuard` + `SkipOnboarding` — start delete flow
- `POST /api/users/account/delete/confirm` — `JwtActiveGuard` + `SkipOnboarding` — password delete
- `POST /api/users/account/restore` — `JwtAuthGuard` — restore soft-deleted account

**BusinessesController** (`apps/api/src/modules/businesses/businesses.controller.ts`)
- `GET /api/businesses/me` — `JwtActiveGuard` — list visible businesses
- `POST /api/businesses/me` — `JwtActiveGuard` — create business
- `GET /api/businesses/me/:slug` — `JwtActiveGuard` + `BusinessAccessGuard` — cabinet detail
- `PATCH /api/businesses/me/:slug` — `JwtActiveGuard` + `BusinessAccessGuard` — update business
- `DELETE /api/businesses/me/:slug` — `JwtActiveGuard` + `BusinessAccessGuard` — hard delete

**PublicBusinessesController** (`apps/api/src/modules/businesses/public-businesses.controller.ts`)
- `GET /api/businesses/public/:slug` — public + `SkipOnboarding` — public view
- `GET /api/businesses/public/:slug/qr/business.png` — public + `SkipOnboarding` — URL QR PNG
- `GET /api/businesses/public/:slug/qr/nbu.png?host=primary|legacy` — public + `SkipOnboarding` — NBU QR PNG

**PaymentsController** (`apps/api/src/modules/payments/payments.controller.ts`)
- `GET /api/payments/catalog` — public + `SkipThrottle` + `SkipOnboarding` — pricing catalog
- `POST /api/payments/checkout-session` — `JwtActiveGuard` — Stripe checkout
- `POST /api/payments/portal-session` — `JwtActiveGuard` — billing portal
- `POST /api/payments/reset` — `JwtActiveGuard` — reset billing state
- `POST /api/payments/webhook/:provider` — public + `SkipThrottle` — Stripe webhook

**StorageController** (`apps/api/src/modules/storage/storage.controller.ts`)
- `POST /api/storage/avatar/upload-url` — `JwtActiveGuard` — presigned R2 URL
- `POST /api/storage/avatar/commit` — `JwtActiveGuard` — bind uploaded avatar
- `DELETE /api/storage/avatar` — `JwtActiveGuard` — remove avatar

**AiController** (`apps/api/src/modules/ai/ai.controller.ts`)
- `POST /api/ai/chat` — `JwtActiveGuard` + `AiRateLimitGuard` — SSE chat
- `GET /api/ai/chat/history` — `JwtActiveGuard` — transcript
- `DELETE /api/ai/chat/history` — `JwtActiveGuard` — clear transcript

**Reports / Invoices / QR**
- `apps/api/src/modules/reports/reports.controller.ts` має no route methods yet
- `InvoicesModule` реєструє `Invoice` schema only; endpoints ще немає
- `QrModule` не має controller; його використовують public business endpoints

## Configuration & Environment

**Loaders and source files**
- API fail-fast loader: `apps/api/src/config/env.ts`
- Web fail-fast loader: `apps/web/src/shared/config/env.ts`
- Next build/proxy/image config: `apps/web/next.config.ts`
- Shared sample: `.env.example`
- Test-only API placeholders: `apps/api/src/test-setup.ts`

**API env: required**
- Runtime/data: `NODE_ENV`, `PORT`, `WEB_URL`, `PAY_PUBLIC_URL`, `MONGODB_URI`, `REDIS_URL`
- Auth: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- OAuth/email: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- Payments: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENTS_SUBSCRIPTION_ENABLED`, `PAYMENTS_ONE_OFF_ENABLED`
- Auth tuning: `AUTH_PASSWORD_MIN_LENGTH`, `AUTH_LOCKOUT_THRESHOLDS`, `AUTH_LOGIN_ATTEMPTS_TTL_MIN`, `AUTH_MAGIC_LINK_TTL_MIN`, `AUTH_MAGIC_LINK_RATE_LIMIT`, `AUTH_MAGIC_LINK_RATE_WINDOW_MIN`, `AUTH_MAGIC_LINK_DEDUP_SEC`, `ACCOUNT_DELETION_GRACE_DAYS`
- AI: `ANTHROPIC_API_KEY`, `AI_CHAT_MAX_TOKENS`, `AI_CHAT_IP_LIMIT`
- Storage: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`

**Web env: required**
- Public base/API: `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_API_URL`
- Public payment host: `NEXT_PUBLIC_PAY_PUBLIC_URL`
- Payments flags: `NEXT_PUBLIC_PAYMENTS_SUBSCRIPTION_ENABLED`, `NEXT_PUBLIC_PAYMENTS_ONE_OFF_ENABLED`
- Storage image host: `NEXT_PUBLIC_STORAGE_HOSTNAME`

**Runtime/build env outside fail-fast loaders**
- `API_INTERNAL_URL` читається в `apps/web/next.config.ts` для `/api` rewrites, якщо заданий.
- `API_INTERNAL_URL` потрібен `apps/web/src/features/business-public/loadPublicView.ts` для server-side public page rendering.
- `WEB_PORT` і `API_PORT` — compose-only helpers, не app loader vars.

**Env invariants**
- Хоча б один із `PAYMENTS_SUBSCRIPTION_ENABLED` або `PAYMENTS_ONE_OFF_ENABLED` має бути `true`.
- `GOOGLE_CALLBACK_URL` має вказувати на web-origin `/api/auth/google/callback`, щоб refresh cookie лишався на web domain.
- `PAY_PUBLIC_URL` і `NEXT_PUBLIC_PAY_PUBLIC_URL` мають представляти той самий public origin.
- Hostname у `R2_PUBLIC_URL` має збігатися з `NEXT_PUBLIC_STORAGE_HOSTNAME`, інакше `next/image` блокує uploaded avatars.
- `AUTH_LOCKOUT_THRESHOLDS` має формат `5:1,10:5,20:15`.
- Public host whitelist hardcoded у `apps/web/src/shared/config/publicHosts.ts`; змінюй його разом із public domain.

**Fail-fast policy**
- Rule source: `docs/conventions/fail-fast.md`.
- Нова env var має синхронно оновити `env.ts`, `.env.example`, `.env` і API test setup, якщо API code імпортує loader.
- Web `NEXT_PUBLIC_*` reads мають використовувати прямий `process.env.VAR`, щоб Next inline-ив їх.

**Infra**
- `docker-compose.dev.yml` стартує Redis + API + web; MongoDB зовнішня через `MONGODB_URI`.
- `docker-compose.yml` містить Redis, API, web і profile `migrations` для one-shot DB scripts.
- Docker builds збирають `@finly/types` до app builds.

## Common Commands

- `pnpm dev` — запуск усіх workspace dev tasks через Turbo
- `pnpm build` — build усіх apps/packages
- `pnpm lint` — lint workspace
- `pnpm format` — Prettier по repo
- `pnpm test` — workspace tests
- `pnpm --filter api dev|build|test|test:e2e|test:cov|email:dev` — API workflow
- `pnpm --filter web dev|build|test|lint` — web workflow
- `pnpm --filter @finly/types build|dev|test` — shared contracts
- `pnpm --filter api migration:slug-lower` — local slugLower migration
- `docker compose -f docker-compose.dev.yml up --build` — local Redis + apps
- `docker compose --profile migrations run --rm api-migrations` — production migration container
- `docker compose up --build -d` — production-like stack

## Testing Strategy

- API unit specs живуть поруч із source у `apps/api/src/**/*.spec.ts`; Jest мапить `@finly/types` на source.
- API e2e specs живуть у `apps/api/test/*.e2e-spec.ts` і використовують `MongoMemoryServer` та mocked provider dependencies.
- Web використовує Jest + jsdom; specs покривають middleware, host routing, auth bootstrap/guards, stores, API clients, public page loading і UI primitives.
- `packages/types` має contract/entity/validation/QR tests; оновлюй їх при зміні shared schema або NBU payload logic.

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

- Source of truth for repo-wide rules: `docs/conventions/README.md`.
- Перед змінами у user-facing copy, env/config, modular boundaries, overlays, shared UI, design tokens або responsive layout перечитуй відповідний convention file у `docs/conventions/`.
- Продукт single-locale Ukrainian. Не додавай `next-intl`, locale URL segments або message catalogs без окремої ADR-scale migration.
- Web boundary rules enforce-яться в `apps/web/eslint.config.mjs`: немає global `src/stores/`, а `shared/` не імпортує higher FSD layers.
- UI поза `shared/ui/` має використовувати `Ui*` primitives для covered native controls.
- Runtime data layer — Mongoose schemas у `apps/api/src/modules/**/schemas`; `prisma/schema.prisma` відсутній.
- Product docs у `docs/product/` є working drafts; для implemented behavior пріоритет мають code і schemas.

## Known Complexities

- `README.md` і частина старих comments ще згадують `app/[locale]`, `next-intl` і ширший i18n; поточний code — root App Router з `<html lang="uk">` та inline Ukrainian copy.
- Soft-deleted recovery розділений між backend `?account_deleted=true`, frontend `bid_account_deleted`, middleware redirects і `JwtAuthGuard` restore. Міняй обидві сторони разом.
- Web middleware приймає auth-рішення за presence cookies (`bid_refresh`, `bid_account_deleted`), а не за token validation; stale cookies можуть redirect-ити до client cleanup.
- Public pay-domain routing залежить від `PUBLIC_HOSTS`, `PAY_PUBLIC_URL`, `NEXT_PUBLIC_PAY_PUBLIC_URL` і local `/etc/hosts` для `pay.finly.local`.
- `API_INTERNAL_URL` не входить у web fail-fast loader, але public page server rendering падає без нього.
- `Business.deletedAt` існує, але Sprint 3 delete — hard-delete після frontend 5s undo delay; не будуй restore logic навколо цього поля.
- Invoices сьогодні тільки schema/contracts. Product docs описують invoice URLs і behavior ширше за implemented API surface.
- Per-bank deep links не реалізовані; public business page наразі отримує NBU universal payload links і QR endpoints з API.
- `@finly/types` runtime резолвиться з `dist`; clean app-only runs часто потребують спочатку `pnpm --filter @finly/types build`.
- R2 avatar upload використовує native `fetch`, не `apiClient`; `Content-Type` має точно збігатися з presigned `image/webp` contract.
- `docs/conventions/tone.md` правильно фіксує single-locale UA, але його reference на email `translations.ts` застарів; фактична email copy живе в `apps/api/src/modules/email/templates/`.
