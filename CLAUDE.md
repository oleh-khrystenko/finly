# Finly

> **Product vision (finly.com.ua):** SaaS для українських ФОП та їх бухгалтерів — генерація платіжних QR-кодів і посилань за стандартом НБУ, щоб клієнти сканували й оплачували без ручного введення реквізитів. У планах — зберігання документів із AI-тегуванням для швидкого пошуку.
>
> **Поточний стан:** monorepo-monolith Next.js 16 + NestJS 11. Реалізовано: auth/session lifecycle, billing Stripe, executions ledger, AI chat Anthropic, avatar storage R2, pure NBU payload-builder (формати 002/003), QR image-render pipeline, Business domain + cabinet CRUD, public payment-сторінка `pay.finly.com.ua/{slug}` через host-aware routing з real NBU app-link CTA. Заплановано (Sprint 4+): інвойси під бізнесом, per-bank deep-links, Free/Paid гейти, document storage з AI-tagging. Shared Zod/TypeScript контракти (`@finly/types`) використовуються обома застосунками.

## Tech Stack

| Шар | Технологія | Версія |
|-----|-----------|--------|
| Core | TypeScript, Node.js, pnpm, Turborepo | TS 5.9, Node 20, pnpm 10.30 |
| Frontend | Next.js (App Router + Turbopack), React, Zustand, TailwindCSS | Next 16.0, React 19.2, Zustand 5, Tailwind 4 |
| Forms | React Hook Form + @hookform/resolvers (Zod) | RHF 7.72 |
| Backend | NestJS, Mongoose, ioredis, Passport | NestJS 11.1, Mongoose 8 |
| Validation | Zod (shared contracts) | Zod 4.3 |
| AI | Anthropic SDK (Claude Haiku 4.5) | SDK 0.80 |
| Payments | Stripe | 20.4 |
| Email | Resend + React Email | 6.9 |
| Storage | Cloudflare R2 (S3 SDK + presigner), `sharp`, `react-easy-crop` | SDK 3, sharp 0.34 |
| QR | `qrcode`, `sharp` (logo overlay) | qrcode 1.5 |
| Тести | Jest, Supertest, MongoMemoryServer, @testing-library/react | Jest 30.2 |

## Architecture Overview

Monorepo з трьома workspace: `apps/api`, `apps/web`, `packages/types`. API — system of record для auth, session lifecycle, billing, executions, AI chat, media storage та businesses; web — тонкий клієнт, що спілкується з API через shared Zod контракти. Frontend — Feature-Sliced Design. Cabinet (`finly.com.ua`) і public payment-page (`pay.finly.com.ua`) ділять один Next.js project через host-aware middleware. Модуль `reports` (API) — scaffold/placeholder; `invoices` — Sprint-1 schema-only scaffold (controller/service у Sprint 4).

## Project Structure

```
apps/
├── api/
│   ├── src/
│   │   ├── main.ts, app.module.ts, app.controller.ts
│   │   ├── config/          # fail-fast env loader
│   │   ├── common/          # decorators, filters, guards, interceptors, modules (Redis), services
│   │   └── modules/         # auth, email, users, payments, ai, reports, storage, businesses, qr, invoices
│   └── scripts/
│       ├── generate-hryvnia-asset.ts
│       └── migrations/      # one-shot DB migrations + spec (npm: migration:slug-lower)
├── web/src/
│   ├── app/                 # pages: root, auth, (protected), host-pay/[slug], privacy, terms (single-locale, uk only)
│   │   └── (protected)/     # ai-chat, billing, business, profile
│   ├── entities/            # user (authStore), navigation (headerNavStore), brand (Logo)
│   ├── features/            # auth, billing, profile, change-theme, business-edit, business-wizard, business-public
│   ├── widgets/             # header (mobileMenuSheetStore)
│   ├── shared/              # api, ui, config (env, publicHosts), styles, icons, seo, lib, fonts, types
│   └── middleware.ts        # host-aware routing (Branch A/B/C) + cabinet auth-cookie checks
packages/
└── types/src/               # constants, enums, entities, contracts, validation, utils, qr
docs/
├── conventions/             # source-of-truth правила
├── manual-checks/           # UAT-чекліст (живі банк-додатки, друк, малі екрани)
├── product/                 # business-flow, qr-decisions, qr-spec, tech-backlog
└── sprints/                 # 01-foundation, 02-qr-core, 03-cabinet-public
```

## Domain Model

### User
Файл: `apps/api/src/modules/users/schemas/user.schema.ts` | Zod: `packages/types/src/entities/user.ts`
- Soft-delete: `deletedAt` + `accountDeletionRequestedAt` (grace period, cron hard-delete)
- Embedded `billing` subdocument (nullable; `lastProviderEventAt` для out-of-order webhook protection)
- Embedded `executions` (`balance`, `freeReportUsed`, `activeReservation` з `compensationOps`) — atomic `$inc`
- `worksAsBookkeeper: boolean` — UI-фільтр для списку бізнесів (Sprint 3 §E5)
- Sparse indexes: `provider.id`, `billing.providerCustomerId`, `billing.providerSubscriptionId`, `executions.activeReservation.expiresAt`

### Business
Файл: `apps/api/src/modules/businesses/schemas/business.schema.ts` | Zod: `packages/types/src/entities/business.ts`
- `type` (enum `'fop'`, ТОВ/ВАТ — Phase 1.5+), `name`, `requisites: { iban, taxId }`, `paymentPurposeTemplate`, `acceptedBanks: BankCode[]`
- `taxationSystem` + `isVatPayer` — coupled rule: `isVatPayer === true ⇒ taxationSystem ∈ {simplified-3, general}`. Refine у Zod entity, write-DTO та service-layer cross-field check для partial PATCH (читає БД при потребі)
- `slug` (case-preserved display) + `slugLower` (lowercase). Unique-index на `slugLower`. Reserved-list — `packages/types/src/constants/reserved-slugs.ts`. Slug-генератор у `slug-generator.service.ts` (8-char A-Za-z0-9, max 10 retries, `crypto.randomBytes`); shared free-fn `generateRandomTail()` reuse-ається у `InvoiceSlugGeneratorService`
- `seoIndexEnabled: boolean` (default false) — toggle публікації у пошуковики
- `invoiceSlugPresetDefault: SlugPreset | null` (Sprint 4 §4.1; default `null` = "не визначено", форма створення інвойсу fallback-ить на global system default `simple`)
- `ownerId: ObjectId | null` + `managers: ObjectId[]` — null-owner режим бухгалтера; інваріант `ownerId === null ⇒ managers.length ≥ 1` у Zod refine
- `deletedAt` навмисно невикористане (Sprint 3 §C2 = hard-delete; поле залишене на майбутнє)
- Indexes: unique `slugLower`, sparse `ownerId`, `managers`

### Invoice
Файл: `apps/api/src/modules/invoices/schemas/invoice.schema.ts` | Zod: `packages/types/src/entities/invoice.ts`
- `businessId` (required), `slug` (case-sensitive — Sprint 4 SP-8 asymmetry), `amount: number | null` (копійки; null = signage-mode "клієнт сам вводить"), `amountLocked` (coupled rule SP-6: `amount === null && amountLocked === true` блокується refine), `paymentPurpose: string | null` (null = inherit з `business.paymentPurposeTemplate` через `effectiveInvoicePurpose`), `validUntil: Date | null`, `slugPreset: SlugPreset | null` (analytics-поле — який пресет згенерував)
- `slugCounterScope: string | null` + `slugCounter: number | null` (Sprint 4 §4.1) — paired counter-fields для preset-режимів з лічильником (`'simple'` | `YYYY` | `YYYY-MM`). `null` для explicit/random/with-purpose
- Indexes: compound unique `(businessId, slug)`, compound `(businessId, createdAt -1)` для list-pagination, sparse `validUntil` (Phase 1.5+ expired-cleanup cron), **partial-unique compound** `(businessId, slugCounterScope, slugCounter)` з `partialFilterExpression: { slugCounterScope: $type 'string', slugCounter: $type 'int' }` — race-блок counter-collision у preset-режимах (Sprint 4 §4.1 risk #2 mitigation)

### ExecutionTransaction
Файл: `apps/api/src/modules/users/schemas/execution-transaction.schema.ts`
- Ledger для credit/debit; compound index `(userId, createdAt desc)`

### ChatMessage
Файл: `apps/api/src/modules/ai/schemas/chat-message.schema.ts`
- AI chat history; compound index `(userId, createdAt)`

### ProcessedWebhookEvent
Файл: `apps/api/src/modules/payments/schemas/processed-webhook-event.schema.ts`
- Unique `(provider, providerEventId)` — Stripe idempotency. Two-phase `pending → applied`; pending видаляється на failure (rollback)

### OrphanedProviderCustomer
Файл: `apps/api/src/modules/payments/schemas/orphaned-provider-customer.schema.ts`
- Унікальна `(provider, providerCustomerId)` черга невдалих delete-ів Stripe customers; max 5 retries через cron

## Module Dependency Map

- `AppModule` → `Auth`, `Email`, `Users`, `Payments`, `Reports`, `Storage`, `Ai`, `Qr`, `Businesses`, `Invoices` + global `ThrottlerGuard` (APP_GUARD), `OnboardingInterceptor` (APP_INTERCEPTOR)
- `AuthModule` ↔ `UsersModule` (`forwardRef`, circular)
- `AuthModule` → `StorageModule` (Google avatar re-upload у `handleGoogleAuth`)
- `EmailModule` — `@Global()`
- `RedisModule` — `@Global()`, exports `REDIS_CLIENT` + `RedisCounterService` (Lua-based atomic counters)
- `PaymentsModule` → `UsersModule`; провайдери: `PAYMENT_PROVIDER` (StripeService) + окремий `CatalogService` зі своїм Stripe SDK instance (no dep on `IPaymentProvider`)
- `AiModule` → `UsersModule`; провайдер `AI_PROVIDER` (AnthropicService); guard `AiRateLimitGuard`
- `StorageModule` → `UsersModule`; провайдер `STORAGE_PROVIDER` (CloudflareR2Service); exports `StorageService` (consumed by `AuthModule`)
- `BusinessesModule` → `MongooseModule.forFeature([Business, Invoice])` + `QrModule` + `UsersModule`; providers: `BusinessesService` (cascade-delete) + `SlugGeneratorService` + `BusinessAccessGuard` + `InvoiceSlugGeneratorService` + `InvoicesService` (повторна реєстрація для `BusinessesController.getBySlug` invoicesCount без cyclic-DI). Exports `MongooseModule` + `BusinessesService`
- `InvoicesModule` (Sprint 4) → `MongooseModule.forFeature(Invoice)` + `forwardRef(() => BusinessesModule)` + `QrModule`; controllers: `InvoicesController` (cabinet) + `PublicInvoicesController` (public); providers: `InvoiceSlugGeneratorService`, `InvoicesService`, `InvoiceAccessGuard`. Exports `MongooseModule`, `InvoiceSlugGeneratorService`, `InvoicesService`
- `QrModule` exports `QrService` (`buildNbuPayloadLinkForInput`, `renderForUrl`, `renderForNbuPayload`); консумується `BusinessesModule.PublicBusinessesController` і `InvoicesModule.PublicInvoicesController`
- Cron: `CleanupService` (6h), `ReservationReconcileService` (5min), `PaymentsCleanupService` (4 AM)
- Web: `shared/api/client.ts` → axios interceptors → refresh dedupe → `authStore`; protected routes → `AuthGuard` → `shared/api/auth.ts`

## Key Patterns

### Створення endpoint
Guard + `@CurrentUser()` + DTO + Service, повертає `{ data: ... }` envelope. Приклад: `apps/api/src/modules/payments/payments.controller.ts`

### Валідація
Zod schema у `packages/types/src/contracts/*` → `createZodDto()` в api dto → ті ж схеми на web через `@hookform/resolvers/zod`. Приклад: `apps/api/src/modules/payments/dto/create-checkout-session.dto.ts`

### Форми (Frontend)
React Hook Form + Zod resolver. Приклад: `apps/web/src/features/profile/ProfileForm.tsx`

### Авторизація (Guards)
- `JwtActiveGuard` — основний, JWT + блокує soft-deleted users
- `JwtAuthGuard` — JWT без soft-delete check (для restore)
- `SubscriptionGuard` — перевіряє `hasActiveSubscription`
- `AiRateLimitGuard` — IP-based Redis rate limit (24h TTL); account-level guard живе атомарно у `AiService.reserveChatRequest`
- `BusinessAccessGuard` — case-insensitive lookup `slugLower`, перевірка ownership/managers, attach до `request.business`
- Файли: `apps/api/src/common/guards/`, `apps/api/src/modules/{ai,businesses}/`

### Onboarding enforcement
`OnboardingInterceptor` (APP_INTERCEPTOR) блокує роути з кодом `ONBOARDING_INCOMPLETE` поки профіль не заповнений. Опт-аут — `@SkipOnboarding()`. Файли: `apps/api/src/common/interceptors/onboarding.interceptor.ts`, `common/decorators/skip-onboarding.decorator.ts`

### Auth/session lifecycle
Access JWT в пам'яті (web), refresh JWT у `bid_refresh` httpOnly cookie, Redis token families з ротацією + reuse detection. Axios дедуплікує concurrent refresh calls.

### Billing/webhook processing
`PAYMENT_PROVIDER` → `StripeService`; two-phase idempotency через `ProcessedWebhookEvent`; out-of-order guard у MongoDB query (`lastProviderEventAt: $lt`). Feature flags для subscription/one-off. Orphaned customer cleanup через `OrphanedProviderCustomer` + daily cron.

### Billing catalog (Stripe as single source of truth)
`CatalogService` (`apps/api/src/modules/payments/catalog.service.ts`) тягне Products/Prices зі Stripe API, кеш у Redis (TTL 5min). Власний Stripe SDK instance (уникає circular DI з `IPaymentProvider`). Warm fetch на startup (fail-fast). Public endpoint `GET /payments/catalog`. Plan/pack codes — TS union типи (структурні ID для UI labels/images/DB); бізнес-дані (ціни, executions, порядок, featured) — з Stripe Product metadata.

### AI chat streaming
`AI_PROVIDER` → `AnthropicService`, SSE через `res.write()`. Durable reservation: `AiService.reserveChatRequest()` робить atomic `findOneAndUpdate` (balance + single-flight guard) → stream → commit/refund. 2-layer protection: IP rate limit + atomic single-document Mongo reservation. Refundable до першого токена, non-refundable після. Файл: `apps/api/src/modules/ai/ai.controller.ts`

### Reservation primitives (generic core API)
`UsersService.commitReservation()` — MongoDB transaction з claim-first порядком (active claim перед side effects). `UsersService.refundReservation()` — single atomic `findOneAndUpdate`, що застосовує `compensationOps` зі збереженого reservation document. `ReservationReconcileService` — generic cron (5 хв), знаходить expired reservations і викликає той самий `refundReservation`. Будь-який feature, що мутує власні поля під час reserve, декларує compensation у `activeReservation.compensationOps`.

### QR generation pipeline
Pure builder у `@finly/types/src/qr/` — host-agnostic, без Node-залежностей: `build002Payload`/`build003Payload` → `encodePayloadAsBase64Url` (isomorphic) → `buildNbuPayloadLink(version, b64, { host })`. Validates через `PayloadInputSchema` + per-field char/byte limits (`FIELD_LIMITS`) + NBU charset whitelist + payload ≤ 507 B + Base64URL ≤ 475 B. Sprint-1 Zod-схеми (`Business.name`, `paymentPurposeTemplate`, `Invoice.paymentPurpose`) деривують max-довжини через `effectiveLimit(...)` = MIN по `PAYLOAD_VERSIONS`.

Image-render у `apps/api/src/modules/qr/`: `QrImageRenderer` (qrcode → PNG, error-correction `Q`) + `QrLogoCompositor` (sharp overlay нормативного asset-у ₴, `logoMaxRatio ≤ 0.20`) + `QrService` orchestrator з `renderForUrl(url)` (для public сторінки) і `renderForNbuPayload(input, version, options)` (повний build → encode → wrap → render).

**Host для format 003 — required `options.host`**: дві named-константи `NBU_HOST_PRIMARY = 'qr.bank.gov.ua'`, `NBU_HOST_LEGACY = 'bank.gov.ua/qr'` у `packages/types/src/qr/url-prefix.ts`. Public-сторінка показує дві кнопки + два QR. Format 002 host фіксований. TS-overload блокує `renderForNbuPayload(..., '003', ...)` без host. Round-trip тест через `jsqr`.

### Avatar upload pipeline (R2)
`STORAGE_PROVIDER` → `CloudflareR2Service` (S3-compatible). Three-step client flow: presigned `POST /storage/avatar/upload-url` → direct PUT до R2 → `POST /storage/avatar/commit`. API ніколи не проксує файли. Presigned PUT підписує лише `Content-Type: image/webp`. Size enforcement на application layer (client pre-check + commit-time `HeadObject` з cleanup + throttler). Commit ідемпотентний. File key: `avatars/{userId}/{uuid}.webp`. Client: `react-easy-crop` → `canvas.toBlob('image/webp', 0.85)` → native `fetch`. HEIC не підтримується (LGPL libheif). Файл: `apps/api/src/modules/storage/storage.service.ts`

### Google OAuth avatar re-upload
`AuthService.handleGoogleAuth` **синхронно** викликає `StorageService.reUploadExternalAvatar()` (fetch Google URL → `sharp.resize(512×512, cover).webp({ quality: 85 })` → `uploadBuffer`) перед `generateTokens`. Trade-off: +300-800ms до callback, але без URL-jump. Failure → `logger.warn` + fall through (наступний login повторить). R2 URL detection через prefix-check на `ENV.R2_PUBLIC_URL`.

### Error handling та message mapping
API повертає machine-readable `code` через `AllExceptionsFilter`; web мапить codes на українські рядки через `shared/api/mapApiCode.ts` (`getApiMessage(code, module?, vars?)`). Single-locale (uk only) — рядки інлайн.

### Soft-delete lifecycle
Запит на видалення → `accountDeletionRequestedAt` + `deletedAt` → grace period → `CleanupService` cron (6h) hard-delete + revoke tokens. Файл: `apps/api/src/modules/users/cleanup.service.ts`

### Frontend auth flow
`AuthInitializer` (client effect) → `refreshToken()` → `getMe()` → hydrate `authStore`. Перевіряє terms version, modal при outdated. `AuthGuard` у protected layout перевіряє auth + onboarding. Middleware (`apps/web/src/middleware.ts`) перевіряє `bid_refresh` cookie для server-side redirects + host-aware routing для public-зони.

### Overlay management
Zustand store → `UiModal`/`UiSheet`/`UiConfirmDialog` → реєстрація у `app/overlays.tsx` (єдиний global mount). Конвенція: `docs/conventions/overlays.md`. Кожен dialog store живе **усередині свого slice** (feature/widget) — глобального `src/stores/` шару не існує (enforced ESLint правилами в `apps/web/eslint.config.mjs`).

### FSD layer inversion via event bus
`shared/lib/authEvents` — parameterless lifecycle events для інверсії залежностей. Нижчий шар (`shared/api`) публікує; вищий (`entities/user/authStore`) підписується. ESLint guardrail `SHARED_MUST_NOT_IMPORT_HIGHER_LAYERS` блокує прямі імпорти з `shared/` у вищі FSD-шари (static + dynamic).

### Execution ledger
Atomic `$inc` на `user.executions.balance` + створення `ExecutionTransaction`. Spend-ендпоінт перевіряє баланс. AI chat теж створює transaction (action `AI_CHAT`). Файл: `apps/api/src/modules/users/users.service.ts`

## API Overview

Global prefix: `/api`. Rate limiting: `ThrottlerModule` (60 req/min global). Global pipes: `ZodValidationPipe`. Global filters: `AllExceptionsFilter`.

### AppController (`apps/api/src/app.controller.ts`)
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| GET | `/` | — | Root |
| GET | `/health` | — | Health check + timestamp + env |

### AuthController (`apps/api/src/modules/auth/auth.controller.ts`)
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| GET | `/auth/google` | `AuthGuard('google')` + `@SkipOnboarding()` | Старт Google OAuth |
| GET | `/auth/google/callback` | `AuthGuard('google')` + `@SkipOnboarding()` | OAuth callback, set refresh cookie |
| POST | `/auth/check-email` | — | Перевірка існування акаунту (rate-limited) |
| POST | `/auth/login/password` | — | Вхід з паролем |
| POST | `/auth/magic-link/send` | — | Відправка magic link |
| POST | `/auth/magic-link/verify` | — | Верифікація magic link |
| POST | `/auth/password/set` | `JwtActiveGuard` + `@SkipOnboarding()` | Встановлення першого паролю |
| POST | `/auth/password/change` | `JwtActiveGuard` + `@SkipOnboarding()` | Зміна паролю, revoke all tokens |
| POST | `/auth/password/reset` | — | Скидання через magic link token |
| POST | `/auth/password/verify` | `JwtActiveGuard` + `@SkipOnboarding()` | Перевірка для sensitive дій |
| POST | `/auth/refresh` | — | Ротація refresh token |
| POST | `/auth/logout` | — | Revoke refresh token |

### UsersController (`apps/api/src/modules/users/users.controller.ts`)
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| GET | `/users/me` | `JwtActiveGuard` + `@SkipOnboarding()` | Профіль + billing snapshot |
| PATCH | `/users/me` | `JwtActiveGuard` + `@SkipOnboarding()` | Оновлення профілю |
| POST | `/users/me/accept-terms` | `JwtActiveGuard` + `@SkipOnboarding()` | Прийняття ToS версії |
| POST | `/users/me/executions/spend` | `JwtActiveGuard` | Витрата executions |
| GET | `/users/me/executions/transactions` | `JwtActiveGuard` | Історія транзакцій |
| POST | `/users/account/delete` | `JwtActiveGuard` + `@SkipOnboarding()` | Запит на видалення |
| POST | `/users/account/delete/confirm` | `JwtActiveGuard` + `@SkipOnboarding()` | Підтвердження паролем |
| POST | `/users/account/restore` | `JwtAuthGuard` | Відновлення акаунту |

### PaymentsController (`apps/api/src/modules/payments/payments.controller.ts`)
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| GET | `/payments/catalog` | `@SkipThrottle()` + `@SkipOnboarding()` | Catalog from Stripe (cached) |
| POST | `/payments/checkout-session` | `JwtActiveGuard` | Створення Stripe checkout |
| POST | `/payments/portal-session` | `JwtActiveGuard` | Створення billing portal URL |
| POST | `/payments/reset` | `JwtActiveGuard` | Скидання billing (видалення Stripe customer) |
| POST | `/payments/webhook/:provider` | `@SkipThrottle()` | Stripe webhook ingestion |

### AiController (`apps/api/src/modules/ai/ai.controller.ts`)
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| POST | `/ai/chat` | `JwtActiveGuard` + `AiRateLimitGuard` | SSE streaming chat |
| GET | `/ai/chat/history` | `JwtActiveGuard` | Історія повідомлень |
| DELETE | `/ai/chat/history` | `JwtActiveGuard` | Очищення історії |

### StorageController (`apps/api/src/modules/storage/storage.controller.ts`)
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| POST | `/storage/avatar/upload-url` | `JwtActiveGuard` | Presigned PUT URL (Content-Type signed, 5-min TTL) |
| POST | `/storage/avatar/commit` | `JwtActiveGuard` | HeadObject verify + update profile.avatar + delete old |
| DELETE | `/storage/avatar` | `JwtActiveGuard` | Clear profile.avatar + delete R2 file |

### BusinessesController (`apps/api/src/modules/businesses/businesses.controller.ts`)
Cabinet zone — slug як primary route-param; resolved через `slugLower` unique-index.
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| GET | `/businesses/me` | `JwtActiveGuard` | Список бізнесів через single-aggregation pipeline (`$lookup` + nested `$count`); response items містять `invoicesCount: number` (Sprint 4 §4.4) |
| POST | `/businesses/me` | `JwtActiveGuard` | Створення (4-step wizard, один POST). Slug сервер генерує. Response містить canonical slug |
| GET | `/businesses/me/:slug` | `JwtActiveGuard` + `BusinessAccessGuard` | Повний об'єкт + `invoicesCount: number` (Sprint 4 §4.2 для cascade-delete-warning + listing counter) |
| PATCH | `/businesses/me/:slug` | `JwtActiveGuard` + `BusinessAccessGuard` | Часткове оновлення; `.strict()` блокує slug/type/ownership; coupled VAT × taxationSystem cross-field check; **`invoiceSlugPresetDefault: SlugPreset \| null`** (Sprint 4 §4.1) |
| DELETE | `/businesses/me/:slug` | `JwtActiveGuard` + `BusinessAccessGuard` | Cascade hard-delete (Sprint 4 §SP-5): atomic `withTransaction` видаляє business + всі його invoices. Response: `{ affectedInvoices: number }`. На non-replica-set Mongo → 500 `CASCADE_DELETE_REQUIRES_REPLICA_SET` |

### PublicBusinessesController (`apps/api/src/modules/businesses/public-businesses.controller.ts`)
Public zone (`pay.finly.com.ua`) — без auth, без cookie. `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`.
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| GET | `/businesses/public/:slug` | `@SkipOnboarding()` | 6 whitelist-полів (`type`, `name`, `slug`, `acceptedBanks`, `seoIndexEnabled`, `nbuLinks: {primary, legacy}`) |
| GET | `/businesses/public/:slug/qr/business.png` | `@SkipOnboarding()` | QR на public URL `{PAY_PUBLIC_URL}/{slug}`; знак гривні в центрі |
| GET | `/businesses/public/:slug/qr/nbu.png?host=primary\|legacy` | `@SkipOnboarding()` | QR з NBU-payload-link (формат 003) на одну з двох allowed адрес |

### InvoicesController (`apps/api/src/modules/invoices/invoices.controller.ts`)
Cabinet zone — Sprint 4 §4.2. Префікс `/businesses/me/:slug/invoices`. Class-level guards: `JwtActiveGuard` + `BusinessAccessGuard`; route-level `InvoiceAccessGuard` для read/update/delete.
| Метод | Шлях | Guards | Опис |
|-------|------|--------|------|
| GET | `/businesses/me/:slug/invoices?page=&limit=` | `JwtActive` + `BusinessAccess` | Paginated list з `sort: { createdAt: -1 }`. Response: `{ items, total, page, limit }` |
| POST | `/businesses/me/:slug/invoices` | `JwtActive` + `BusinessAccess` | Create через `CreateInvoiceSchema` discriminated union `slugInput`. Backend генерує slug + tail; retry-on-11000 для race-collisions (до 3 спроб). Response: повний invoice з canonical slug |
| GET | `/businesses/me/:slug/invoices/:invoiceSlug` | `JwtActive` + `BusinessAccess` + `InvoiceAccess` | Повний invoice (case-sensitive slug lookup, SP-8) |
| PATCH | `/businesses/me/:slug/invoices/:invoiceSlug` | `JwtActive` + `BusinessAccess` + `InvoiceAccess` | Partial update; `.strict()` блокує slug/slugPreset/businessId; coupled `amount × amountLocked` cross-field check через `$expr`-filter |
| DELETE | `/businesses/me/:slug/invoices/:invoiceSlug` | `JwtActive` + `BusinessAccess` + `InvoiceAccess` | Hard-delete (5s frontend-Undo на web-стороні) |

### PublicInvoicesController (`apps/api/src/modules/invoices/public-invoices.controller.ts`)
Public zone — Sprint 4 §4.3. Без auth, з `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`.
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| GET | `/businesses/public/:slug/invoices/:invoiceSlug` | `@SkipOnboarding()` | 7 whitelist-полів (invoice fields + nested business view + `nbuLinks`); `paymentPurpose` resolved через `effectiveInvoicePurpose` (always-string у view, не nullable) |
| GET | `/businesses/public/:slug/invoices/:invoiceSlug/qr/business.png` | `@SkipOnboarding()` | QR на канонічну public-URL інвойсу |
| GET | `/businesses/public/:slug/invoices/:invoiceSlug/qr/nbu.png?host=primary\|legacy` | `@SkipOnboarding()` | QR з NBU-payload-link (формат 003) — payload містить amount + lockMask + validUntil |

### ReportsController
Scaffold без ендпоінтів.

## Configuration & Environment

**Loaders**
- API: `apps/api/src/config/env.ts` (fail-fast, crash on missing)
- Web: `apps/web/src/shared/config/env.ts` (direct `process.env.VAR` для Next.js inlining)
- Шаблон: `.env.example`
- Політика: `docs/conventions/fail-fast.md`

**API — ALL required (crash if missing, no defaults)**
- `NODE_ENV`, `PORT`, `WEB_URL` (cabinet origin), `PAY_PUBLIC_URL` (public payment-page origin — host для QR)
- `MONGODB_URI`, `REDIS_URL`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- `PAYMENTS_SUBSCRIPTION_ENABLED`, `PAYMENTS_ONE_OFF_ENABLED` (хоча б один `true`)
- Auth tuning: `AUTH_PASSWORD_MIN_LENGTH`, `AUTH_LOCKOUT_THRESHOLDS`, `AUTH_LOGIN_ATTEMPTS_TTL_MIN`, `AUTH_MAGIC_LINK_TTL_MIN`, `AUTH_MAGIC_LINK_RATE_LIMIT`, `AUTH_MAGIC_LINK_RATE_WINDOW_MIN`, `AUTH_MAGIC_LINK_DEDUP_SEC`, `ACCOUNT_DELETION_GRACE_DAYS`
- AI: `ANTHROPIC_API_KEY`, `AI_CHAT_MAX_TOKENS`, `AI_CHAT_IP_LIMIT`
- Storage (R2): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` (hostname мусить збігатись з `NEXT_PUBLIC_STORAGE_HOSTNAME` — див. Known Complexities)

**Web — ALL required (crash if missing)**
- `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_PAY_PUBLIC_URL` — public payment-page origin (cabinet UI: copy-link, "відкрити в новій вкладці"); має збігатись з API `PAY_PUBLIC_URL`
- `NEXT_PUBLIC_PAYMENTS_SUBSCRIPTION_ENABLED`, `NEXT_PUBLIC_PAYMENTS_ONE_OFF_ENABLED`
- `NEXT_PUBLIC_STORAGE_HOSTNAME` — R2 CDN hostname (для `next/image` `remotePatterns`; `next.config.ts` fail-fast'ить при відсутності)

**Web — optional**
- `API_INTERNAL_URL` — server-side reverse proxy target (rewrites у `next.config.ts`)

**Infra**
- `WEB_PORT`, `API_PORT` — Docker compose порти

## Common Commands

```
pnpm dev                                              # dev all workspaces
pnpm build                                            # build all
pnpm lint                                             # lint all
pnpm format                                           # Prettier
pnpm test                                             # test all

pnpm --filter api dev|build|test|test:e2e|test:cov    # API-only
pnpm --filter web dev|build|test                      # Web-only
pnpm --filter @finly/types build                      # rebuild shared types
pnpm --filter api migration:slug-lower                # one-shot DB migration

pnpm --filter api -- jest path/to/file.spec.ts        # один API тест
pnpm --filter web -- jest path/to/file.test.ts        # один Web тест

docker compose -f docker-compose.dev.yml up --build   # dev (Redis only)
docker compose up --build -d                          # prod-like
```

## Testing Strategy

- API unit specs: `apps/api/src/**/*.spec.ts` (поруч з модулями)
- API e2e: `apps/api/test/*.e2e-spec.ts` (MongoMemoryServer + provider overrides)
- Web: Jest + jsdom, поруч з source файлами
- Test env setup: `apps/api/src/test-setup.ts` — fallback env через `??=` (запобігає fail-fast crash)
- CI: `.github/workflows/ci.yml` (lint → build → API tests з MongoDB service)
- Deploy: `.github/workflows/deploy.yml` (SSH → Docker build → health checks → auto-rollback)

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

- Source of truth для repo-wide правил: `docs/conventions/README.md`
- Читай перед роботою з відповідними зонами: `tone.md`, `fail-fast.md`, `modular-boundaries.md`, `ui-primitives.md`, `design-tokens.md`, `overlays.md`, `responsive.md`
- **Manual checks (UAT-чекліст):** `docs/manual-checks/README.md` — реєстр перевірок, які неможливо автоматизувати (живі банк-додатки, малі екрани, друк). Файл — **навмисно простою мовою без термінів**. Тестова логіка спринта мусить додавати сюди новий пункт, якщо включає сценарій, що unit-тести не закриють.

## Known Complexities

- **rawBody для Stripe**: `NestFactory.create(AppModule, { rawBody: true })` у `main.ts` — без цього signature verification ламається.
- **AuthModule ↔ UsersModule circular**: обидва імпортують один одного через `forwardRef`. Порушення = Nest DI crash.
- **Refresh token rotation atomic**: `GETDEL` у Redis = single-use. Reuse detection тригерить full revoke. Grace 10s для concurrent tabs.
- **Out-of-order webhooks**: subscription updates через `lastProviderEventAt` guard (`$lt`, не `$lte`). Старіші events тихо пропускаються — не баг.
- **Refresh cookie через proxy**: `next.config.ts` проксує `/api/*` на backend → `bid_refresh` видимий і middleware, і API (same origin).
- **`test-setup.ts` fallback env**: без нього fail-fast крашить Jest до запуску. Використовує `??=`.
- **`packages/types` build order**: ДО `apps/api`/`apps/web`. Turborepo гарантує через `dependsOn: ["^build"]`; manual build без turbo зламається.
- **Single-locale (uk only)**: продукт українською без перемикача. Email-копія інлайн у React Email темплейтах (`apps/api/src/modules/email/templates/*.tsx`); `<Html lang="uk">` константа у `templates/layouts/base.tsx`; форматування дат — `DATE_LOCALE = 'uk-UA'` константа + `formatDate()` метод у `email.service.ts`. URL без локаль-префікса. Локалізація — окрема міграція.
- **Webhook route dynamic provider**: URL `/webhook/:provider`, але лише `stripe`. Unknown — silent reject.
- **Orphaned customer retry cap**: `PaymentsCleanupService` робить max 5 спроб. Після — manual intervention.
- **CatalogService own Stripe instance**: уникає circular DI з `IPaymentProvider` → `StripeService`. Один `STRIPE_SECRET_KEY`.
- **Catalog cache startup**: `onModuleInit()` робить warm fetch. Stripe недоступний при старті → app crash (fail-fast). Після — fallback через Redis TTL.
- **Execution proration на plan change**: `calculatePlanChangeAdjustment()` рахує пропорцію залишку періоду через `previousPriceId` з webhook + `getPriceToExecutionsMap()`.
- **AI chat SSE після headers**: після `flushHeaders()` помилки йдуть як SSE event `ERROR`. Reservation відбувається ДО SSE headers — будь-яка 4xx (balance, limit, active reservation) — звичайний HTTP error.
- **AI chat durable reservation**: reserve (atomic `findOneAndUpdate`) → stream → commit (MongoDB transaction, claim-first) або refund. Refundable до першого токена. Cron `ReservationReconcileService` — generic safety net (5 хв).
- **Redis atomic counters via Lua**: `RedisCounterService.eval()` Lua scripts для atomicity. Fixed-window: TTL лише при першому increment. Sliding-window: TTL оновлюється при кожному. Повертають post-increment count.
- **Reservation compensation pattern**: `activeReservation.compensationOps` зберігає `$inc` операції, які core `refundReservation` застосовує атомарно. Для AI зараз `{ inc: {} }`; нові features декларують `$inc`-компенсації тут.
- **Presigned PUT signs Content-Type only**: `Content-Length` НЕ підписується (forbidden Fetch header; signed `ContentLength` — exact-match, не upper bound). Клієнт мусить відправити `Content-Type: image/webp` рівно таке самe — інакше R2 → 403.
- **Avatar size enforcement на application layer**: client pre-check + commit `HeadObject` validation з `deleteObject` cleanup + `ThrottlerGuard` на presigned URL endpoint.
- **R2 URL detection для safe delete**: `StorageService.isR2Url()` — prefix-check проти `ENV.R2_PUBLIC_URL`. Зовнішні URL (legacy Google) пропускають R2 delete без помилки.
- **Commit idempotency**: повторний `commitAvatarUpload` з тим самим fileKey повертає existing URL без `safeDeleteR2File(oldUrl)` — без guard другий виклик видалив би щойно збережений файл.
- **Storage error mapping**: всі raw SDK/network/sharp помилки обгорнуті в `mapStorageError()` → `InternalServerErrorException({ code: AVATAR_UPLOAD_FAILED })`. Структуровані `HttpException` з власним кодом проходять untouched.
- **Orphaned R2 files trade-off**: upload без commit залишає файл у `avatars/{userId}/`. MVP acceptable; scale — TTL cron або lifecycle policy.
- **R2 public URL ↔ web hostname invariant**: `R2_PUBLIC_URL` hostname МУСИТЬ дорівнювати `NEXT_PUBLIC_STORAGE_HOSTNAME`. Не збігаються → `next/image` блокує фото runtime. `next.config.ts` fail-fast'ить.
- **Sharp на Alpine Docker**: sharp 0.33+ автоматично через `optionalDependencies` (`node:20-alpine` без правок Dockerfile). Edge cases — `apk add --no-cache vips`.
- **OAuth callback sync re-upload**: `handleGoogleAuth` синхронно викликає `reUploadExternalAvatar` перед видачею токенів. +300-800ms, без UX-стрибка URL. Failure non-critical: warn + fall through.
- **QR field separator semantics**: рядки розділені `\n`. **Trailing-empty fields обовʼязкові** (002 — рівно 13 полів, 003 — 17). Без них payload коротший і банк-парсер відхиляє QR. `FIELD_ORDER` всередині builder-а фіксує довжину масиву — guarantee enforced builder-ом.
- **QR UTF-8 bytes vs chars**: норматив оперує `B`/`C` для різних полів. JS `.length` рахує UTF-16 code units; Cyrillic = 2 bytes, апостроф U+2019 = 3 bytes, emoji = 4 bytes. `assertWithinUtf8Limits` у `packages/types/src/qr/limits.ts` тримає окремі `chars`/`bytes` ліміти.
- **QR error-correction `Q`, не `H`**: норматив 003 §IV.10.4 дозволяє лише `M` або `Q`. Дефолт `Q` (~25% надлишковості) + `logoMaxRatio ≤ 0.20` hard guard. Деталі — `docs/product/qr-spec/diff-002-003.md`.
- **QR fieldLockMask bit-numbering**: bit N (1-indexed у нормативі) → bit-pos N (0-indexed у JS), не bit-pos N-1 (підтверджено `FEFF` прикладом). Required-locked mask = `0xC83E`. Деталі — `docs/product/qr-spec/README.md`.
- **QR Base64URL ≤ 475 B vs raw ≤ 507 B**: 475 b64url chars ↔ ~356 raw bytes — restrictive за 507. `buildNbuPayloadLink` асертить b64url-довжину **до** host-валідації. Builder додатково assert'ить raw ≤ 507.
- **QR sharp у ts-jest**: ts-jest interop bug з `sharp` default-export. У `qr-logo.compositor.ts` + `qr.service.integration.spec.ts` — `import sharp = require('sharp')`. `storage.service.ts` — default-import (тести мокають sharp).
- **QR asset shipping**: `qr/assets/hryvnia-symbol.png` копіюється у `dist/` через `nest-cli.json` `compilerOptions.assets`. `QrService` резолвить через `__dirname`. Custom-logo замість гривні — Sprint 6 (Paid).
- **Slug case-preserved + uniqueness on lower**: Twitter/Instagram-style. Display (`Business.slug`) — як зафіксував ФОП; lookup і uniqueness на `slugLower` (Mongoose unique-index). Reserved-перевірка на lowercase. **308 Permanent Redirect** на canonical case при URL mismatch (Next.js `permanentRedirect` у Server Component → `host-pay/[slug]/page.tsx`; `/dashboard` → `/business` legacy теж 308 у middleware). Migration `2026-05-03-businesses-slug-lower.ts` — idempotent, fail-safe на duplicate-key.
- **Hard-delete з frontend-only 5s Undo**: жоден API call поки 5s не минули. **Timer ID живе у closure**, не у React ref — cabinet page розмонтовується через optimistic redirect (`router.replace('/business')`); cleanup-effect із clearTimeout вбив би timer. Sonner toast queue живе у root layout. Browser-unload вб'є setTimeout автоматично. `pendingDeletesStore` (Zustand) ховає slug з list UI синхронно; на success slug залишається у store до browser-unload. Backend transient flag відкинутий — `setTimeout` у Node не переживає рестарт і не працює multi-instance.
- **Bookkeeper-toggle тільки UI-фільтр**: ownership-bit на user (`worksAsBookkeeper`). Перемикання не мутує жодного бізнесу — фільтрує `getOwnedAndManaged` query (ON → ownerless+managers; OFF → owned). Sprint 3 toggle доступний усім; Sprint 6 додасть Paid-gating. Frontend optimistic update + rollback на error.
- **Public endpoint whitelist + nbuLinks vector**: 6 полів — `type`, `name`, `slug`, `acceptedBanks`, `seoIndexEnabled`, `nbuLinks: {primary, legacy}`. Реквізити (IBAN, ІПН) **не** віддаються JSON-ом напряму, але присутні у `nbuLinks` через Base64URL-encoded payload (той самий vector як QR PNG). Whitelist інваріант: дані доступні **тільки через формати, що читаються банком як платіжна команда**. `PublicBusinessSchema.parse()` strip-ає leak-fields на serialization step.
- **host-aware routing на одному Next.js project**: cabinet (`finly.com.ua`) і public (`pay.finly.com.ua`) ділять один контейнер. Middleware має 4 branches: A1 (public+root-slug → rewrite на internal `/host-pay/{slug}`); **A2 (public+2-сегментний path `/{biz}/{inv}` → rewrite на `/host-pay/{biz}/{inv}`, Sprint 4 §4.7)**; B (public+non-root, non-2-segment → 404); C (cabinet+`/host-pay/` → 404, direct-URL-attack захист). Host comparison **case-insensitive** за RFC 7230 §2.7. Reserved-slug check у Branch A1/A2 — захист від рекурсивного rewrite (тільки на business-slug; invoice-slug — будь-який). Cookie isolation: `bid_refresh` без `Domain=` → invisible на pay-host. Server Components `app/host-pay/[slug]/page.tsx` + `app/host-pay/[slug]/[invoiceSlug]/page.tsx` роблять defense-in-depth host check через `headers()`. ISR `revalidate: 60`.

- **Invoice slug-case asymmetry vs business-slug** (Sprint 4 §SP-8): business-slug case-insensitive (vanity-target, Twitter-style); invoice-slug **case-sensitive** (99% system-generated; case-insensitive lookup нульовий UX-value). Compound-unique `(businessId, slug)` зберігається case-sensitive. Server Component на public-page робить canonical-redirect 308 тільки для business-slug; invoice-slug exact-match-or-404.

- **Slug-preset counter monotonic per (business, scope)** (Sprint 4 §4.1): без окремого counter-document. `MAX(slugCounter)+1` aggregation у `nextCounterByScope` з filter `{ businessId, slugCounterScope }`. **Partial-unique compound** `(businessId, slugCounterScope, slugCounter)` race-блокує counter-collision на write-path: два паралельні `POST /invoices` з тим самим preset-counter → один проходить, другий падає на 11000 → `InvoicesService.create` retry (до 3 спроб). Без partial-unique-compound retry-on-11000 не спрацював би — `(businessId, slug)` compound-unique пропускав би race (різні tails → різні slug-strings). `slugCounterScope`: `'simple'` | `YYYY` | `'YYYY-MM'`. Counter-presets записують paired `(scope, counter)`; non-counter (explicit/random/with-purpose) — обидва null, виключені з partial-index через `partialFilterExpression`.

- **Lock-mask FEFF/FFFF derived from `amountLocked`** (Sprint 4 §4.3 + SP-6): backend-only mapping у `payload-mapper.ts` (`buildPayloadInputFromInvoice`). `amountLocked=true → FFFF` (все locked), `amountLocked=false → FEFF` (поле 8 "Сума" editable). Frontend оперує boolean `amountLocked` — не знає про hex-mask. Інверсна UI-семантика switch-а "Дозволити правити суму" (ON ⇔ `amountLocked=false`) живе тільки у формах (`CreateInvoiceForm`, `AmountSection`).

- **`validUntil` у Kyiv-tz, не UTC** (Sprint 4 §4.1 boundary fix): `formatYymmddhhmmss` + `getKyivYearMonth` через `Intl.DateTimeFormat({ timeZone: 'Europe/Kyiv' })` + `formatToParts`. Контракт NBU input явно інтерпретує payload-час як локальний український. UTC-варіант ламав би: 1 червня 00:30 Київ (= UTC 31 травня 21:30Z) отримував би immutable slug `2026-05-...` замість `2026-06-...` (з `with-month`-пресета); `validUntil` у payload відображав би на 2-3 години раніше. Залежність від ICU tzdata — `Europe/Kyiv` available у Node 20+ full-icu за замовчуванням; small-icu fallback не реалізовано (fail-fast invariant).

- **Cascade hard-delete atomic-or-nothing** (Sprint 4 §SP-5): `BusinessesService.delete` cascade видаляє business + всі його invoices через `connection.startSession() → session.withTransaction()`. Mongo вимагає replica-set для transactions; standalone mongod кидає "Transaction numbers are only allowed on a replica set member or mongos" → service ловить, мапить на `CASCADE_DELETE_REQUIRES_REPLICA_SET` 500. Жодного fallback на 2 sequential deletes — orphan-invoices state свідомо неможливий. Production Atlas — replica-set за замовчуванням; dev — три варіанти (Atlas / Docker `--replSet rs0` / local mongod) у root `README.md`. Test-suite: `MongoMemoryReplSet` для cascade-tests і businesses-e2e (transactional-aware); `MongoMemoryServer` standalone для решти.

- **Mongo `_id → id` JSON transform** (Sprint 4 §4.4 fix): глобальний helper `applyJsonTransform(schema)` у `apps/api/src/common/mongoose/json-transform.ts` додає `toJSON`/`toObject`-transform: `_id: ObjectId → id: string` через `.toString()`, strip `__v`. Застосовано на `BusinessSchema` + `InvoiceSchema`. Без цього frontend `Business.id` (Zod-entity-shape `id: string`) була б undefined, що ламало `key={item.id}` і dedup-логіки. Aggregation pipeline (`getOwnedAndManagedWithInvoicesCount`) не проходить через Mongoose-transform — `_id → id`-mapping робиться явно у `$addFields + $unset`-stage.

- **Public invoice payload — `paymentPurpose` always-resolved** (Sprint 4 §4.7): backend `PublicInvoicesController.getPublic` викликає `effectiveInvoicePurpose(invoice.paymentPurpose, business.paymentPurposeTemplate)` перед serialization → `PublicInvoiceSchema.paymentPurpose: string` (NOT nullable). Inheritance-rule `null → business template` — impl-detail backend; client отримує ефективний рядок, що співпадає з NBU payload-purpose. Single source of truth: UI sub-info і банківська команда показують однаковий текст.
