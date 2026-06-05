# Finly

> SaaS для українських ФОП та їх бухгалтерів — генерація платіжних QR-кодів і посилань за стандартом НБУ; у планах — зберігання документів із AI-тегуванням.

## Tech Stack

| Шар        | Технологія                                                | Версія                                 |
| ---------- | --------------------------------------------------------- | -------------------------------------- |
| Core       | TypeScript, Node.js, pnpm, Turborepo                      | TS 5.9, Node 20, pnpm 10.30            |
| Frontend   | Next.js (App Router + Turbopack), React, Zustand, Tailwind | Next 16, React 19.2, Zustand 5, Tw 4   |
| Forms      | React Hook Form + Zod resolver                            | RHF 7.72                               |
| Backend    | NestJS, Mongoose, ioredis, Passport, nestjs-zod            | NestJS 11.1, Mongoose 8                |
| Validation | Zod (shared contracts у `packages/types`)                 | Zod 4.3                                |
| AI         | Anthropic SDK (Claude Haiku 4.5)                          | SDK 0.80                               |
| Payments   | Stripe (білінг; міграція на WayForPay — Sprint 17, planned) | 20.4                                  |
| Email      | Resend + React Email                                      | 6.9                                    |
| Storage    | Cloudflare R2 (S3 SDK + presigner), `sharp`               | SDK 3, sharp 0.34                      |
| Content    | `react-markdown` (help-center статті)                      | 10.1                                   |
| QR         | `qrcode`, `sharp` (logo overlay), `jsqr` (test round-trip) | qrcode 1.5                             |
| Тести      | Jest, Supertest, MongoMemoryServer / MongoMemoryReplSet, @testing-library/react | Jest 30.2 |

## Architecture Overview

Monorepo з трьома workspace: `apps/api` (NestJS — system of record), `apps/web` (Next.js — тонкий клієнт), `packages/types` (shared Zod contracts). Frontend організовано за Feature-Sliced Design. Один Next.js project обслуговує два host-и (`finly.com.ua` cabinet + `pay.finly.com.ua` public) через host-aware `proxy.ts` (Next 16 rename of `middleware.ts`) з 3-сегментним матрьошковим routing-ом. Реалізовано: auth/session lifecycle, billing Stripe, executions ledger, AI chat streaming, public help-center + grounded AI-assistant, avatar R2, NBU QR pipeline (формати 002/003 + branded frames), трирівнева доменна модель Business → Account → Invoice з editable vanity-slug-ами + anti-squatting history, anon QR-preview лендінг + claim flow, orphan-profile cleanup. Модуль `reports` — scaffold.

## Project Structure

```
apps/
├── api/
│   ├── src/
│   │   ├── main.ts, app.module.ts, app.controller.ts
│   │   ├── config/          # fail-fast env loader
│   │   ├── common/          # decorators, filters, guards, interceptors, modules (Redis), intl, mongoose
│   │   └── modules/         # auth, email, users, payments, ai, reports, storage, qr,
│   │                        # businesses, accounts, invoices, landing-claim, orphan-cleanup
│   └── scripts/
│       ├── drop-dev-db.ts, generate-hryvnia-asset.ts
│       └── migrations/      # one-shot DB migrations + spec
├── web/src/
│   ├── app/                 # root (anon landing), auth, (protected), help, host-pay/[slug]/…, privacy, terms
│   ├── entities/            # user, brand, business, invoice, navigation, qr-landing-draft, help-article
│   ├── features/            # auth, billing, profile, change-theme, business-{wizard,edit,public},
│   │                        # account-{create,edit,public}, invoice-{create,edit,public},
│   │                        # qr-landing-preview, help-center, help-chat
│   ├── widgets/             # header, public-{header,footer}, help-footer, landing-* (hero, why, banks, …)
│   ├── shared/              # api, ui, config, lib, seo, styles, icons, fonts, types
│   └── proxy.ts             # host-aware routing (Branch A0/A1/A2/A3/B/C) + auth cookie checks
packages/
└── types/src/               # constants, enums, entities, contracts, validation, utils, qr, help
docs/
├── conventions/             # tone, fail-fast, modular-boundaries, ui-primitives, design-tokens, overlays, responsive
├── manual-checks/           # UAT-чекліст (живі банк-додатки, друк, малі екрани)
├── product/                 # business-flow, qr-decisions, qr-custom-branding, tech-backlog
└── sprints/                 # 01-foundation … 16-public-help-docs (+ 17 WayForPay у 06-billing)
```

## Domain Model

### User

Файл: `apps/api/src/modules/users/schemas/user.schema.ts` | Zod: `packages/types/src/entities/user.ts`

- Soft-delete: `deletedAt` + `accountDeletionRequestedAt` (grace period, cron hard-delete)
- Embedded `billing` subdocument (nullable; `lastProviderEventAt` для out-of-order webhook guard)
- Embedded `executions` (`balance`, `freeReportUsed`, `activeReservation.compensationOps`) — atomic `$inc`
- `worksAsBookkeeper: boolean` — UI-фільтр для списку бізнесів
- `profileCompletionReminders` — cron-only поля orphan-cleanup; `pendingPostLoginTarget` — deep-link recovery
- Sparse indexes: `provider.id`, `billing.providerCustomerId`, `billing.providerSubscriptionId`, `executions.activeReservation.expiresAt`

### Business

Файл: `apps/api/src/modules/businesses/schemas/business.schema.ts` | Zod: `packages/types/src/entities/business.ts`

- `type: BusinessType` immutable post-creation; 4 значення (`individual` | `fop` | `tov` | `organization`)
- Top-level `taxId` — string, формат per-type (10-РНОКПП checksum vs 8-ЄДРПОУ без checksum)
- `taxationSystem` + `isVatPayer` — coupled (`requiresTaxation(type) ⇔ both non-null`)
- `slug` (case-preserved) + `slugLower` (unique index, reserved-list check)
- `ownerId: ObjectId | null` + `managers: ObjectId[]` — null-owner режим бухгалтера
- `claimIdempotencyKey` + partial-unique `(ownerId, claimIdempotencyKey)` (anon-claim dedup)
- Indexes: unique `slugLower`, sparse `ownerId`, non-unique `managers`, partial-unique claim-idempotency

### Account

Файл: `apps/api/src/modules/accounts/schemas/account.schema.ts` | Zod: `packages/types/src/entities/account.ts`

- Банківський рахунок під бізнесом (`businessId` immutable, `iban` immutable post-creation)
- `bankCode: BankCode | null` — **stored derived** (обчислюється з IBAN рівно один раз на create)
- `slug` (case-preserved) + `slugLower` — editable vanity (Sprint 15), compound-unique `(businessId, slugLower)`
- `invoiceSlugPresetDefault: SlugPreset | null` (per-account нумерація інвойсів)
- Indexes: unique `(businessId, slugLower)`, unique `(businessId, iban)`, non-unique `(businessId, createdAt)`
- Delete: cascade hard-delete (TX) разом з усім invoice-піддерев'ям; `ACCOUNT_HAS_INVOICES` 409 прибрано (Sprint 15+)

### Invoice

Файл: `apps/api/src/modules/invoices/schemas/invoice.schema.ts` | Zod: `packages/types/src/entities/invoice.ts`

- Nest-иться під `accountId` (required, immutable); `businessId` denormalized для cascade/analytics
- `slug` + `slugLower` — editable vanity (Sprint 15), compound-unique `(accountId, slugLower)`
- `amount: number | null` (копійки; null = signage-mode); coupled з `amountLocked`
- `paymentPurpose: string | null` (null → inherit з `business.paymentPurposeTemplate`)
- `payeeSnapshot` — фіксує `recipientName/iban/taxId/paymentPurpose` на момент create
- `slugCounterScope` + `slugCounter` — partial-unique `(accountId, slugCounterScope, slugCounter)` запобігає counter-collision
- Indexes: unique `(accountId, slugLower)`, `(accountId, createdAt -1, _id -1)`, `(businessId, createdAt -1)`, sparse `validUntil`

### Slug-history схеми (anti-squatting, Sprint 14/15)

- `BusinessSlugHistory`, `AccountSlugHistory`, `InvoiceSlugHistory` (`*/schemas/*-slug-history.schema.ts`)
- Зберігають старі `slugLower` після rename → 308-redirect на canonical + блокування reuse у scope; TTL ~90 днів
- Scope: business — глобальний; account/invoice — `(businessId|accountId, slugLower)` compound-unique
- Cascade-delete видаляє history разом з parent (інакше orphan-hit lookup + slug заблокований до TTL)

### Інші схеми

- `InvoiceSlugCounter` (`invoices/schemas/invoice-slug-counter.schema.ts`) — окрема collection проти counter reuse; unique `(accountId, scope)`, `last` через `$inc`
- `ExecutionTransaction` (`users/schemas/execution-transaction.schema.ts`) — ledger; compound `(userId, createdAt -1)`
- `ChatMessage` (`ai/schemas/chat-message.schema.ts`) — cabinet AI history; compound `(userId, createdAt)`
- `ProcessedWebhookEvent` (`payments/schemas/`) — unique `(provider, providerEventId)`, two-phase `pending → applied`
- `OrphanedProviderCustomer` (`payments/schemas/`) — unique `(provider, providerCustomerId)`, max 5 retries

## Module Dependency Map

- `AppModule` → всі модулі + global `ThrottlerGuard` (`APP_GUARD`), `OnboardingInterceptor` (`APP_INTERCEPTOR`)
- Throttler buckets (`apps/api/src/app.module.ts`): `default` 60/min, `public-payment` 600/min, `qr-preview` 10/min, `help-chat` 20/min
- `AuthModule` ↔ `UsersModule` (`forwardRef`, circular)
- `UsersModule` → `StorageModule` (avatar — `AvatarController` живе у Users після Sprint 13); Google avatar re-upload через `StorageService`
- `EmailModule`, `RedisModule` — `@Global()`; `RedisModule` exports `REDIS_CLIENT` + `RedisCounterService` (Lua-based atomic counters)
- `PaymentsModule` → `UsersModule`; `PAYMENT_PROVIDER` (StripeService) + окремий `CatalogService` зі своїм Stripe SDK (no dep on `IPaymentProvider`)
- `AiModule` → `UsersModule`; `AI_PROVIDER` (AnthropicService) + cabinet `AiRateLimitGuard` + public `HelpChatRateLimitGuard`
- **One-way DAG**: `Users ← Businesses ← Accounts ← Invoices`
  - `BusinessesModule` → registers `Business, Account, Invoice, InvoiceSlugCounter, *SlugHistory` schemas (для cascade)
  - `AccountsModule` → `BusinessesModule` + `QrModule`; registers `Invoice/Counter/InvoiceSlugHistory` (cascade-delete)
  - `InvoicesModule` → `BusinessesModule` + `AccountsModule` + `QrModule`
- `LandingClaimModule` → `BusinessesModule` + `AccountsModule` + `UsersModule`; містить `MagicLinkVerifyController` (Sprint 13 separation — verify делегує anon-claim)
- `OrphanCleanupModule` → `UsersModule` + `BusinessesModule` (Sprint 12 separation; cascade-delete orphan businesses)
- `QrModule` — exports `QrService`; consumed by 3 public controllers + cabinet/landing
- Cron services: `CleanupService` (users; 6h), `ReservationReconcileService` (5min), `PaymentsCleanupService` (4 AM), `OrphanProfileCleanupService` (orphan businesses)

## Key Patterns

### Створення endpoint

`@UseGuards()` + `@CurrentUser()` decorator + Zod DTO + Service. Відповідь — `{ data: ... }` envelope. Приклад: `apps/api/src/modules/payments/payments.controller.ts`

### Валідація

Zod схема у `packages/types/src/contracts/*` → `createZodDto()` у NestJS DTO. Web reuse-ить ту саму схему через `@hookform/resolvers/zod`. Discriminated-union DTO використовуються через param-level pipe (приклад: `BusinessesController.create`).

### Форми (Frontend)

React Hook Form + Zod resolver. Приклад: `apps/web/src/features/profile/ProfileForm.tsx`. Wizard-store з multi-step navigation + persist — `apps/web/src/features/business-wizard/store.ts`.

### Guards

- `JwtActiveGuard` — основний, JWT + блокує soft-deleted
- `JwtAuthGuard` — JWT без soft-delete check (тільки restore)
- `SubscriptionGuard` — перевіряє `hasActiveSubscription`
- `AiRateLimitGuard` / `HelpChatRateLimitGuard` — IP-based Redis rate limit (24h TTL; cabinet vs public help)
- `BusinessAccessGuard` / `AccountAccessGuard` / `InvoiceAccessGuard` — slug-lookup (case-insensitive `slugLower`) + attach `request.{business,account,invoice}`

Файли: `apps/api/src/common/guards/`, `apps/api/src/modules/{businesses,accounts,invoices,ai}/`

### Onboarding enforcement

`OnboardingInterceptor` (APP_INTERCEPTOR) блокує роути з `ONBOARDING_INCOMPLETE` поки профіль не заповнений. Opt-out — `@SkipOnboarding()`. Файл: `apps/api/src/common/interceptors/onboarding.interceptor.ts`.

### Auth/session lifecycle

Access JWT in-memory (web), refresh JWT в `bid_refresh` httpOnly cookie, Redis token families з ротацією + reuse detection. Axios дедуплікує concurrent refresh calls (`apps/web/src/shared/api/client.ts`).

### Billing webhooks

`PAYMENT_PROVIDER` → `StripeService`. Two-phase idempotency через `ProcessedWebhookEvent` (pending → applied). Out-of-order guard у Mongo query (`lastProviderEventAt: $lt`).

### Catalog (Stripe as source of truth)

`CatalogService` тягне Products/Prices зі Stripe; кеш у Redis 5 min TTL. Власний Stripe SDK instance (уникає circular з `IPaymentProvider`). Warm fetch на startup (fail-fast). Public `GET /payments/catalog`. Plan codes — TS union; ціни/executions/featured — Stripe metadata.

### AI chat + public help-assistant

Cabinet: SSE через `res.write()`. `AiService.reserveChatRequest` робить atomic `findOneAndUpdate` (balance + single-flight) → stream → commit/refund. Refundable до першого токена. Public help (`POST /ai/help/chat`, Sprint 16): anon, без executions/history-persist, grounded на `packages/types/src/help` статтях; 2 layers — IP rate-limit + global daily-budget circuit-breaker.

### Reservation primitives

`UsersService.commitReservation` — Mongo TX з claim-first порядком. `refundReservation` — single atomic `findOneAndUpdate`, що застосовує `compensationOps`. `ReservationReconcileService` cron підбирає expired. Фіча, що мутує поля при reserve, декларує `$inc`-компенсації у `activeReservation.compensationOps`.

### QR pipeline

Pure builder у `@finly/types/src/qr/` — host-agnostic: `build00{2,3}Payload` → `encodePayloadAsBase64Url` → `buildNbuPayloadLink(version, b64, { host })`. Validates payload ≤ 507 B + Base64URL ≤ 475 B + UTF-8 byte limits + NBU charset. Image-render у `apps/api/src/modules/qr/`: `QrImageRenderer` + `QrLogoCompositor` (sharp overlay ₴) + branded frames (Sprint 14) + `QrService` orchestrator (`renderForUrl` / `renderForNbuPayload`).

### Avatar pipeline (R2)

Three-step: presigned `POST /storage/avatar/upload-url` → direct PUT до R2 → `POST /storage/avatar/commit` (HeadObject verify + delete old). Presigned PUT підписує лише `Content-Type: image/webp`. Файл-ключ `avatars/{userId}/{uuid}.webp`. Client — `react-easy-crop` → canvas webp 0.85. Controller — `AvatarController` у `UsersModule` (Sprint 13).

### Error mapping

API повертає machine-readable `code` через `AllExceptionsFilter` (включно з `PayloadValidationError` → 400/500 за family). Web мапить через `apps/web/src/shared/api/mapApiCode.ts` (`getApiMessage(code, module?, vars?)`). Single-locale uk only.

### Soft-delete lifecycle

Delete request → `accountDeletionRequestedAt` + `deletedAt` → grace period → `CleanupService` cron (6h) hard-delete + revoke tokens. Файл: `apps/api/src/modules/users/cleanup.service.ts`.

### Overlay management

Zustand store → `UiModal`/`UiSheet`/`UiConfirmDialog`/`UiDangerGateDialog` → реєстрація у `apps/web/src/app/overlays.tsx`. Конвенція: `docs/conventions/overlays.md`. Кожен dialog store живе всередині свого slice (enforced ESLint).

### Cascade-delete confirmation (UiDangerGateDialog)

Деструктивне підтвердження — користувач вписує очікувані числа (кількість вкладеного) у cloze-фразу замість назви/ланцюга модалок. `apps/web/src/shared/ui/UiDangerGateDialog/` (`gates: { label, expected }[]` + `renderPrompt`). Account/Business delete cascade-видаляють піддерево; дія активна лише на повний збіг. Account-delete API повертає `{ affectedInvoices }` (інформативний toast).

### FSD layer inversion

`shared/lib/authEvents` — parameterless lifecycle events. Нижчий шар (`shared/api`) публікує, вищий (`entities/user`) підписується. ESLint guardrail `SHARED_MUST_NOT_IMPORT_HIGHER_LAYERS`.

### JSON transform для Mongo

`applyJsonTransform(schema)` (`apps/api/src/common/mongoose/json-transform.ts`) — глобальний helper: `_id: ObjectId → id: string`, strip `__v`. Застосовано на всі домен-схеми. Aggregation pipelines не проходять через transform — `_id → id` робиться явно у `$addFields + $unset`.

## API Overview

Global prefix `/api`. Rate limiting: `ThrottlerModule` named buckets. Global pipes: `ZodValidationPipe`. Global filters: `AllExceptionsFilter`. Деталі endpoint-ів — у відповідних `*.controller.ts`; нижче — карта.

### AppController — `GET /`, `GET /health`

### AuthController (`apps/api/src/modules/auth/auth.controller.ts`)

- `GET /auth/google` + `/auth/google/callback` — Google OAuth (`@SkipOnboarding`)
- `POST /auth/check-email`, `/login/password`, `/refresh`, `/logout`
- `POST /auth/magic-link/send` — magic-link; **verify живе у `MagicLinkVerifyController`** (LandingClaimModule) і може містити anon-claim payload + termsVersion
- `POST /auth/password/{set,change,verify}` — `JwtActive` + `@SkipOnboarding`; `/password/reset` — через magic-link token

### UsersController (`apps/api/src/modules/users/users.controller.ts`)

- `GET /users/me` + `PATCH /users/me` + `POST /users/me/accept-terms` — `JwtActive` + `@SkipOnboarding`
- `POST /users/me/executions/spend` + `GET /users/me/executions/transactions` — `JwtActive`
- `POST /users/account/delete` + `/delete/confirm` — `JwtActive` + `@SkipOnboarding`
- `POST /users/account/restore` — `JwtAuthGuard` (без soft-delete блокування)
- Avatar: `AvatarController` — `POST /storage/avatar/upload-url`, `/commit`, `DELETE /storage/avatar` (class-level `JwtActive`)

### PaymentsController

- `GET /payments/catalog` — `@SkipThrottle` + `@SkipOnboarding`; cached 5 min
- `POST /payments/checkout-session` / `portal-session` / `reset` — `JwtActive`
- `POST /payments/webhook/:provider` — `@SkipThrottle`, rawBody, only `stripe`

### AiController

- `POST /ai/chat` — `JwtActive` + `AiRateLimitGuard`; SSE
- `POST /ai/help/chat` — anon public help-assistant, `help-chat` throttle + `HelpChatRateLimitGuard` + `@SkipOnboarding`; SSE
- `GET` + `DELETE /ai/chat/history` — `JwtActive`

### Businesses / Accounts / Invoices

Cabinet під `JwtActiveGuard`; slug-роути через `*AccessGuard`. Префікси матрьошкою:
`/businesses/me/:slug` → `/accounts/:accountSlug` → `/invoices/:invoiceSlug`.

- `GET /businesses/me` — список з `accountsCount` + `invoicesCount`; `POST` create; `GET/PATCH/DELETE /:slug` (cascade hard-delete TX)
- `GET/POST /…/accounts`, `GET/PATCH/DELETE /:accountSlug` — DELETE = cascade TX → `{ affectedInvoices }`
- `GET/POST /…/invoices?page=&limit=`, `GET/PATCH/DELETE /:invoiceSlug` — create (retry-on-11000); DELETE (5 s frontend Undo)

Public (`'public-payment'` 600/min) — `/businesses/public/:slug` → `/account/:accountSlug` → `/invoices/:invoiceSlug`:

- view-endpoint-и (whitelist schema; `Cache-Control: no-store` на invoice) + historical-slug 308-redirect
- `GET …/qr/business.png` (QR на канонічну public URL) + `GET …/qr/nbu.png?host=primary|legacy` (003 payload-link)

### QrController — `apps/api/src/modules/qr/qr.controller.ts`

- `GET /qr/landing.png` — статичний branded QR на лендінгу (`@SkipThrottle`, cached)
- `POST /qr/preview` — `@Throttle({ 'qr-preview': 10/min })` + `@SkipThrottle({ default: true })`; без auth/cookie/DB; hard-coded `'individual'`; формат 003

### ReportsController — scaffold без ендпоінтів

## Configuration & Environment

**Loaders**

- API: `apps/api/src/config/env.ts` (fail-fast, crash on missing)
- Web: `apps/web/src/shared/config/env.ts` (direct `process.env.VAR` для Next.js client inlining)
- Шаблон: `.env.example` · Політика: `docs/conventions/fail-fast.md`

**API — required (crash if missing, no defaults)**

- `NODE_ENV`, `PORT`, `WEB_URL` (cabinet origin), `PAY_PUBLIC_URL` (public payment-page origin)
- `MONGODB_URI` (mandatory replica-set), `REDIS_URL`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- `PAYMENTS_SUBSCRIPTION_ENABLED`, `PAYMENTS_ONE_OFF_ENABLED` (хоча б один `true`)
- Auth tuning: `AUTH_PASSWORD_MIN_LENGTH`, `AUTH_LOCKOUT_THRESHOLDS`, `AUTH_LOGIN_ATTEMPTS_TTL_MIN`, `AUTH_MAGIC_LINK_TTL_MIN`, `AUTH_MAGIC_LINK_RATE_LIMIT`, `AUTH_MAGIC_LINK_RATE_WINDOW_MIN`, `AUTH_MAGIC_LINK_DEDUP_SEC`, `ACCOUNT_DELETION_GRACE_DAYS`
- Orphan-cleanup (Sprint 12): `ORPHAN_REMINDER_FIRST_DAYS`, `ORPHAN_REMINDER_FINAL_DAYS`, `ORPHAN_CLEANUP_DELETION_DAYS`
- AI cabinet: `ANTHROPIC_API_KEY`, `AI_CHAT_MAX_TOKENS`, `AI_CHAT_IP_LIMIT`
- AI public help (Sprint 16): `HELP_CHAT_MAX_TOKENS`, `HELP_CHAT_IP_LIMIT`, `HELP_CHAT_DAILY_BUDGET`
- Storage (R2): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`
- **Cross-field invariants** (fail-fast у env.ts): `AUTH_MAGIC_LINK_TTL_MIN * 60 ≥ AUTH_MAGIC_LINK_DEDUP_SEC`; `ORPHAN_REMINDER_FIRST < FINAL < DELETION`

**Web — required**

- `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_PAY_PUBLIC_URL` — public payment-page origin (має збігатись з API `PAY_PUBLIC_URL`)
- `NEXT_PUBLIC_PAYMENTS_SUBSCRIPTION_ENABLED`, `NEXT_PUBLIC_PAYMENTS_ONE_OFF_ENABLED`
- `NEXT_PUBLIC_STORAGE_HOSTNAME` — R2 CDN hostname (для `next/image` `remotePatterns`; `next.config.ts` fail-fast)

**Web — optional**

- `API_INTERNAL_URL` — server-side reverse proxy target

**Infra**

- `WEB_PORT`, `API_PORT` — Docker compose ports; `HELP_CHAT_*` прокинуто у dev/prod compose

## Common Commands

```
pnpm dev                                            # dev all workspaces
pnpm build                                          # build all
pnpm lint
pnpm format
pnpm test

pnpm --filter api dev|build|test|test:e2e|test:cov  # API-only
pnpm --filter api email:dev                         # React Email preview @ :3100
pnpm --filter web dev|build|test                    # Web-only
pnpm --filter @finly/types build                    # rebuild shared types

pnpm --filter api migration:slug-lower              # 2026-05-03 Business slugLower
pnpm --filter api migration:invoices-payee-snapshot # 2026-05-08
pnpm --filter api migration:accounts-null-auto-name # 2026-06-02
pnpm --filter api migration:nested-slug-lower       # 2026-06-03 Account/Invoice slugLower (Sprint 15)
pnpm --filter api migration:all                     # all migrations in order

pnpm --filter api -- jest path/to/file.spec.ts      # один API тест
pnpm --filter web -- jest path/to/file.test.ts      # один web тест

docker compose -f docker-compose.dev.yml up --build # dev (Redis only)
docker compose up --build -d                        # prod-like
```

## Testing Strategy

- API unit: `apps/api/src/**/*.spec.ts` (поруч з модулями)
- API e2e: `apps/api/test/*.e2e-spec.ts` (MongoMemoryServer + provider overrides)
- Cascade-tests: `MongoMemoryReplSet` (потрібен replica-set для TX)
- Web: Jest + jsdom поруч з source
- Env setup: `apps/api/src/test-setup.ts` — fallback env через `??=`
- CI: `.github/workflows/ci.yml` (lint → build → API tests з MongoDB service)
- Deploy: `.github/workflows/deploy.yml` (SSH → Docker → health checks → auto-rollback)

<!-- MANUAL:START -->

# Rules

- Before making ANY code changes, read the relevant module's files to understand current implementation
- Always check existing patterns in similar modules before creating new ones

## Project Conventions (MANDATORY)

All AI agents MUST read and follow rules in `docs/conventions/`:

- **[Tone & Style](docs/conventions/tone.md)** — tone and style for all user-facing messages (toasts, errors, confirmations)
- **[Fail Fast](docs/conventions/fail-fast.md)** — required env vars policy, no silent fallbacks

Full index: [docs/conventions/README.md](docs/conventions/README.md)

  <!-- MANUAL:END -->

## Rules & Conventions

- Source of truth: `docs/conventions/README.md` (`tone`, `fail-fast`, `modular-boundaries`, `ui-primitives`, `design-tokens`, `overlays`, `responsive`)
- **Manual checks (UAT):** `docs/manual-checks/README.md` — реєстр перевірок, які unit-тести не закривають (живі банк-додатки, малі екрани, друк). Спринт мусить додавати сюди новий пункт, якщо включає такий сценарій.

## Known Complexities

- **rawBody для Stripe**: `NestFactory.create(AppModule, { rawBody: true })` у `main.ts` — без цього signature verification ламається.
- **AuthModule ↔ UsersModule circular**: обидва через `forwardRef`.
- **Refresh token rotation atomic**: Redis `GETDEL` = single-use. Reuse detection → full revoke. Grace 10 s для concurrent tabs.
- **Out-of-order webhooks**: `lastProviderEventAt: $lt` guard. Старіші events тихо ігноруються.
- **`packages/types` build order**: ДО `apps/api`/`apps/web`. Turborepo `dependsOn: ["^build"]` гарантує — manual build без turbo зламається.
- **`test-setup.ts` fallback env**: без нього fail-fast крашить Jest до запуску (`??=`).
- **Single-locale uk only**: продукт українською без перемикача. Email-копії інлайн; URL без locale-префіксу.
- **CatalogService own Stripe instance**: уникає circular DI з `IPaymentProvider`. Startup warm fetch → Stripe недоступний ⇒ app crash (fail-fast).
- **AI chat SSE errors after headers**: після `flushHeaders()` помилки йдуть як SSE `ERROR`-event. Reservation робиться ДО SSE headers — будь-яка 4xx — звичайний HTTP error.
- **Presigned PUT signs Content-Type only**: `Content-Length` НЕ підписується (forbidden Fetch header). Клієнт мусить надіслати `Content-Type: image/webp` exact-match — інакше R2 → 403.
- **Avatar commit idempotency**: повторний commit з тим самим fileKey повертає existing URL без `safeDeleteR2File(oldUrl)` — без guard другий виклик видалив би щойно збережений файл.
- **R2 public URL ↔ web hostname invariant**: `R2_PUBLIC_URL` hostname МУСИТЬ дорівнювати `NEXT_PUBLIC_STORAGE_HOSTNAME` — інакше `next/image` блокує фото. `next.config.ts` fail-fast.
- **QR field separator semantics**: рядки розділені `\n`. Trailing-empty fields ОБОВ'ЯЗКОВІ (002 — 13 полів, 003 — 17). Без них банк-парсер відхиляє QR.
- **QR UTF-8 bytes vs chars**: норматив оперує `B`/`C`. JS `.length` рахує UTF-16 code units; Cyrillic = 2 B, U+2019 = 3 B. `assertWithinUtf8Limits` (`packages/types/src/qr/limits.ts`) тримає окремі ліміти.
- **QR error-correction `Q`, не `H`**: норматив 003 §IV.10.4 дозволяє лише `M` або `Q`. Дефолт `Q` (~25%) + `logoMaxRatio ≤ 0.20`.
- **QR Base64URL ≤ 475 chars vs raw ≤ 507 B**: b64url restrictive за raw. `buildNbuPayloadLink` асертить b64url до host-валідації.
- **QR sharp у ts-jest**: interop bug з default-export. У `qr-logo.compositor.ts` + integration-spec — `import sharp = require('sharp')`. `storage.service.ts` — default-import (тести мокають).
- **`PayloadValidationError` mapping**: окремий `instanceof`-check у `AllExceptionsFilter`. Overall-size overflow → 400 `PAYLOAD_TOO_LARGE`. Field-format → 400 `VALIDATION_ERROR`. Host-config → 500.
- **Slug case-preserved + uniqueness on lower** (Twitter-style): display `slug`, lookup і uniqueness на `slugLower`. Reserved-перевірка на lowercase лише для business-slug. **308 Permanent Redirect** на canonical case.
- **Editable nested-slug + history (Sprint 15)**: account/invoice slug тепер editable vanity (як business). Старий `slugLower` → `*SlugHistory` collection (TTL ~90 днів) для 308-redirect + anti-squatting reuse-block у scope. Cascade-delete мусить чистити history — інакше orphan-hit lookup + заблокований slug.
- **Hard-delete з frontend-only 5s Undo**: жоден API call поки 5 s. **Timer ID живе у closure**, не у React ref — cabinet page розмонтовується через optimistic redirect; cleanup-effect з clearTimeout вбив би timer. `pending*DeletesStore` (Zustand) ховає item з list UI синхронно.
- **Cascade-delete confirmation = ввести числа, не назву**: `UiDangerGateDialog` вимагає вписати кількість вкладеного (рахунки/реквізити) для cascade-видалення. 409 `ACCOUNT_HAS_INVOICES` прибрано — account-delete тепер cascade як business (повертає `affectedInvoices`).
- **Public endpoint whitelist — leak-vector тільки через NBU-payload-link**: реквізити IBAN/taxId не leak-аються JSON-ом — лише через формати, що читаються банком як платіжна команда. `ibanMask = '•{last4}'` server-derived. `Public*Schema.parse()` strip-ають leak-fields.
- **Host-aware routing на одному Next.js project (`proxy.ts`, не `middleware.ts` у Next 16)**: cabinet/public ділять контейнер. Branches: **A0** (public+`/` → explainer); **A1** (public+`/{biz}` → rewrite + `Cache-Control: no-store` проти 1→2-account redirect-flip); **A2**/**A3** (account/invoice); **B** (public+невалідний-segment → 404); **C** (cabinet+`/host-pay/` → 404, direct-URL guard). Host comparison case-insensitive. `bid_refresh` без `Domain=` → invisible на pay-host. Server Components `host-pay/[slug]/*` роблять defense-in-depth host check через `headers()`.
- **Invoice slug-case asymmetry**: business-slug case-insensitive (vanity-target); invoice/account slug compound-unique на `slugLower`. Два account-и одного business можуть мати інвойс з однаковим slug через per-account counter-namespace.
- **Counter monotonic per `(accountId, scope)`**: окрема `InvoiceSlugCounter` collection (захист від reuse after delete). Fast-path `findOneAndUpdate({$inc: { last: 1 }})`; lazy-bootstrap на first-touch. Session-binding з invoice-TX — abort rollback-ить counter. Partial-unique + retry-on-11000 (3) у `InvoicesService.create`.
- **Lock-mask FEFF/FFFF derived from `amountLocked`**: backend-only mapping у `payload-mapper.ts`. `true → FFFF` (locked), `false → FEFF` (editable). Frontend оперує boolean — інверсна UI-семантика "Дозволити правити суму" живе тільки у формах.
- **`validUntil` у Kyiv-tz, не UTC**: `Intl.DateTimeFormat({ timeZone: 'Europe/Kyiv' })` + `formatToParts`. NBU input — локальний український час. UTC ламав би slug `with-month` на edge нічних меж.
- **Cascade hard-delete atomic-or-nothing**: `BusinessesService.delete` + `AccountsService.delete` через `withTransaction` (parent + accounts + invoices + counters + history). Mongo вимагає replica-set; standalone mongod → 500 `TRANSACTION_REQUIRES_REPLICA_SET` / `CASCADE_DELETE_REQUIRES_REPLICA_SET`. Жодного fallback на sequential. Test-suite: `MongoMemoryReplSet`.
- **Account/Business pre-count поза транзакцією**: `affectedInvoices` у response інформативний (toast). Stale by ~tick на concurrent-create не порушує atomic-or-nothing.
- **Public root 1-Account redirect — 307 not 308**: Branch A1 при `accounts.length === 1` робить 307 на `/{biz}/{acc}`. Chrome агресивно кешує 308 in-memory навіть з `Cache-Control: no-cache` — користувач після додавання 2-го застряг би.
- **NBU charset refine на entity-Zod**: `businessNameSchema`, `*Purpose`-schemas мають `.refine(isWithinNbuCharset)` поверх char/byte-limits. Інакше невалідний-для-NBU символ (emoji, multi-line) проходив save → QR-render падав з 500.
- **`useHasHydrated` через `useSyncExternalStore`**: Zustand `persist` гідратує асинхронно. RHF `defaultValues` frozen на mount → потрібен gate. Канонічний React API — SSR-safe + без `react-hooks/set-state-in-effect` warning.
- **`publicPostJson`/`streamHelpChat` symmetric до `publicFetchJson`**: native `fetch` з `credentials: 'omit'`. Axios `apiClient` (withCredentials + Bearer) для anon-flow заборонений — cabinet-credentials просочилися б. Help-chat history — client-side only.
- **Public help-assistant grounded**: контент-джерело — `packages/types/src/help` статті (single source для help-center UI + AI-grounding). Anon, без executions/persist; global daily-budget circuit-breaker поверх IP-limit.
- **Claim-flow intent state-machine**: `qrLandingDraftStore.intent: 'idle' | 'claim-pending' | 'claimed' | 'claim-failed'`. `useClaimLandingDraft` — sibling до `AuthGuard` у `(protected)/layout.tsx`. Гілка B (incomplete profile після magic-link signup): hook fires автоматично після PATCH `/users/me`.
- **Anon-claim 2 sequential POSTs + form-recovery**: `LandingClaimService.attemptLandingClaim` робить Business → Account create. Response 3-state: `'success'` | `'business-failed'` | `'account-failed'` (з `partialBusinessSlug`). Success-with-state, не throw. Окремий `LandingClaimModule` містить і `MagicLinkVerifyController` (Sprint 13 dependency-inversion).
- **Magic-link dedup × overwrite з `KEEPTTL`**: `sendMagicLink` дозволяє overwrite trio `landingDraft + claimIdempotencyKey + termsVersion` у dedup-window. Без `KEEPTTL` `SET` reset-нув би TTL. Env invariant `AUTH_MAGIC_LINK_TTL_MIN * 60 ≥ AUTH_MAGIC_LINK_DEDUP_SEC` — fail-fast.
- **`Business.claimIdempotencyKey` partial-unique**: persisted UUID v4 + partial-unique `(ownerId, claimIdempotencyKey)`. `partialFilterExpression: { claimIdempotencyKey: { $type: 'string' } }` критично — plain sparse ламав би cabinet wizard-create через null-bucket. Tab-close mid-flight resume: retry з тим самим UUID.
- **Terms-pre-stamp у `verifyMagicLink`**: order — auth-resolve → `stampAcceptedTerms` ДО `attemptLandingClaim`. Інакше frontend `acceptTerms()` post-claim throw на network glitch залишав би business+account без terms-stamp. Frontend `acceptTerms()` idempotent через server-filter `acceptedTermsVersion: { $ne: version }`. Google OAuth / password-flows — Sprint 13+ scope.
- **Orphan-profile cleanup (Sprint 12)**: `OrphanCleanupModule` (окремий від Users — separation of concerns). Cron шле reminders на `FIRST`/`FINAL` днях і cascade-видаляє orphan businesses incomplete-profile users на `DELETION`. Env invariant `FIRST < FINAL < DELETION` fail-fast.
