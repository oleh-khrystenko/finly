# Finly

> **Product vision (finly.com.ua):** SaaS для українських ФОП та їх бухгалтерів — генерація платіжних QR-кодів і посилань за стандартом НБУ, щоб клієнти сканували й оплачували без ручного введення реквізитів. У планах — зберігання документів із AI-тегуванням для швидкого пошуку.
>
> **Поточний стан репозиторію:** QR/НБУ-флоу та document storage ще не реалізовані. Зараз це monorepo-monolith на Next.js 16 + NestJS 11 з тех-фундаментом — auth/session lifecycle, billing (Stripe), executions ledger, AI chat (Anthropic), avatar storage (R2). Shared Zod/TypeScript контракти використовуються обома застосунками. Доменна модель і ендпоінти нижче описують саме цей фундамент.

## Tech Stack

| Шар | Технологія | Версія |
|-----|-----------|--------|
| Core | TypeScript, Node.js, pnpm, Turborepo | TS 5.9, Node 20, pnpm 10.30 |
| Frontend | Next.js (App Router + Turbopack), React, Zustand, TailwindCSS | Next 16.0.1, React 19.2, Zustand 5, Tailwind 4 |
| Forms | React Hook Form + @hookform/resolvers (Zod) | RHF 7.72 |
| Backend | NestJS, Mongoose, ioredis, Passport | NestJS 11.1, Mongoose 8 |
| Validation | Zod (shared contracts) | Zod 4.3 |
| AI | Anthropic SDK (Claude Haiku 4.5) | SDK 0.80 |
| Payments | Stripe | 20.4 |
| Email | Resend + React Email | 6.9 |
| Storage | Cloudflare R2 (S3 SDK + presigner), `sharp`, `react-easy-crop` | SDK 3, sharp 0.34 |
| Тести | Jest, Supertest, MongoMemoryServer, @testing-library/react | Jest 30.2 |

## Architecture Overview

Monorepo з трьома workspace: `apps/api`, `apps/web`, `packages/types`. API — system of record для auth, session lifecycle, billing, executions, AI chat та media storage; web залишається тонким клієнтом і спілкується з API через shared Zod контракти. Frontend використовує Feature-Sliced Design. Модуль `reports` (API) — scaffold/placeholder без бізнес-логіки. Модуль `storage` — avatar upload pipeline через Cloudflare R2 (presigned PUT + server-side Google avatar re-upload з `sharp`). Модуль `ai` — streaming chat з Anthropic через SSE з execution-based billing та IP rate limiting.

## Project Structure

```
apps/
├── api/src/
│   ├── main.ts, app.module.ts
│   ├── config/          # fail-fast env loader
│   ├── common/          # decorators, filters, guards, interceptors, modules (Redis)
│   └── modules/         # auth, email, users, payments, ai, reports, storage
├── web/src/
│   ├── app/             # pages: root, auth, (protected), privacy, terms (single-locale, uk only)
│   ├── entities/        # user (authStore), navigation (headerNavStore), brand (Logo)
│   ├── features/        # auth, billing, profile, change-theme — own their dialog/state stores in-slice
│   ├── widgets/         # header (mobileMenuSheetStore)
│   └── shared/          # api, ui, config, styles, icons, seo, lib (authEvents bus), fonts, types
packages/
└── types/src/           # contracts, entities, enums, constants, validation, utils
docs/
└── conventions/         # source-of-truth правила
```

## Domain Model

### User
Файл: `apps/api/src/modules/users/schemas/user.schema.ts` | Zod: `packages/types/src/entities/user.ts`
- Soft-delete через `deletedAt` + `accountDeletionRequestedAt` (grace period, cron hard-delete)
- Embedded `billing` subdocument (nullable, створюється лише при першій billing-події) з `lastProviderEventAt` для out-of-order webhook protection
- Embedded `executions` subdocument (`balance`, `freeReportUsed`, `activeReservation`) з atomic `$inc` операціями
- Sparse indexes: `provider.id`, `billing.providerCustomerId`, `billing.providerSubscriptionId`, `executions.activeReservation.expiresAt`

### ExecutionTransaction
Файл: `apps/api/src/modules/users/schemas/execution-transaction.schema.ts`
- Ledger для credit/debit операцій з executions (type, action, amount, balanceAfter)
- Compound index `(userId, createdAt desc)` для швидких запитів останніх транзакцій

### ChatMessage
Файл: `apps/api/src/modules/ai/schemas/chat-message.schema.ts`
- Повідомлення AI чату (userId, role: user|assistant, content)
- Compound index `(userId, createdAt)` для отримання історії по користувачу

### ProcessedWebhookEvent
Файл: `apps/api/src/modules/payments/schemas/processed-webhook-event.schema.ts`
- Unique `(provider, providerEventId)` — idempotency key для Stripe webhooks
- Two-phase: `status` переходить `pending → applied`; при помилці pending-запис видаляється (rollback)

### OrphanedProviderCustomer
Файл: `apps/api/src/modules/payments/schemas/orphaned-provider-customer.schema.ts`
- Unique `(provider, providerCustomerId)` — черга невдалих видалень Stripe customers
- Retry з лічильником `attempts` (max 5), cron `PaymentsCleanupService`

## Module Dependency Map

- `AppModule` → `AuthModule`, `EmailModule`, `UsersModule`, `PaymentsModule`, `ReportsModule`, `StorageModule`, `AiModule`
- `AppModule` global providers: `ThrottlerGuard` (APP_GUARD), `OnboardingInterceptor` (APP_INTERCEPTOR)
- `AuthModule` ↔ `UsersModule` (`forwardRef`, circular)
- `AuthModule` → `StorageModule` (for Google avatar re-upload у `handleGoogleAuth`)
- `EmailModule` — `@Global()`, доступний всім модулям
- `RedisModule` — `@Global()`, exports `REDIS_CLIENT` token + `RedisCounterService` (Lua-based atomic counters)
- `PaymentsModule` → `UsersModule` + `PAYMENT_PROVIDER` injection token + `CatalogService` + `REDIS_CLIENT`
- `CatalogService` → own Stripe SDK instance + `REDIS_CLIENT` (no dependency on `IPaymentProvider`)
- `AiModule` → `UsersModule` + `REDIS_CLIENT` + `AI_PROVIDER` injection token (AnthropicService)
- `StorageModule` → `UsersModule` + `STORAGE_PROVIDER` injection token (CloudflareR2Service); exports `StorageService` (consumed by `AuthModule`)
- `CleanupService` (cron, every 6h) → `AuthService` + `UserModel`
- `ReservationReconcileService` (cron, every 5min) → `UsersService` — generic expired reservation refund
- `PaymentsCleanupService` (cron, 4 AM) → `PAYMENT_PROVIDER` + `OrphanedProviderCustomerModel`
- Web: `shared/api/client.ts` → axios interceptors → refresh dedupe → `authStore`
- Web: protected routes → `AuthGuard` компонент → auth store → `shared/api/auth.ts`

## Key Patterns

### Створення endpoint
Guard + `@CurrentUser()` decorator + DTO + Service, повертає `{ data: ... }` envelope. Приклад: `apps/api/src/modules/payments/payments.controller.ts`

### Валідація
Zod schema в `packages/types/src/contracts/*` → `createZodDto()` в api dto → ті ж Zod schemas на фронті через `@hookform/resolvers/zod`. Приклад: `apps/api/src/modules/payments/dto/create-checkout-session.dto.ts`

### Форми (Frontend)
React Hook Form + Zod resolver для всіх форм. Приклад: `apps/web/src/features/profile/ProfileForm.tsx`

### Авторизація (Guards)
- `JwtActiveGuard` — **основний**, перевіряє JWT + блокує soft-deleted users
- `JwtAuthGuard` — тільки JWT без перевірки soft-delete (використовується для restore)
- `SubscriptionGuard` — перевіряє `hasActiveSubscription`
- `AiRateLimitGuard` — IP-based Redis rate limit (24h TTL); account-level guards (executions balance + single-flight reservation) живуть атомарно у `AiService.reserveChatRequest`
- Файли: `apps/api/src/common/guards/`, `apps/api/src/modules/ai/guards/`

### Onboarding enforcement
Глобальний `OnboardingInterceptor` (APP_INTERCEPTOR) блокує роути з кодом `ONBOARDING_INCOMPLETE` поки профіль не заповнений. Пропускається через `@SkipOnboarding()` decorator. Файли: `apps/api/src/common/interceptors/onboarding.interceptor.ts`, `apps/api/src/common/decorators/skip-onboarding.decorator.ts`

### Auth/session lifecycle
Access JWT в пам'яті (web), refresh JWT в `bid_refresh` httpOnly cookie, Redis token families з ротацією і reuse detection. Axios дедуплікує concurrent refresh calls.

### Billing/webhook processing
Provider abstraction (`PAYMENT_PROVIDER` → `StripeService`), two-phase idempotency через `ProcessedWebhookEvent`, atomic out-of-order guard через `lastProviderEventAt` в MongoDB query. Feature flags контролюють subscription/one-off. Orphaned customer cleanup через `OrphanedProviderCustomer` + daily cron.

### Billing catalog (Stripe as single source of truth)
`CatalogService` (`apps/api/src/modules/payments/catalog.service.ts`) fetches Products/Prices from Stripe API, caches in Redis (TTL 5 min). Has own Stripe SDK instance (not via `IPaymentProvider`) to avoid circular DI. Warms cache on startup (fail-fast). Public endpoint `GET /payments/catalog` — no auth, applies feature flags. Plan/pack codes remain as TypeScript union types (`SubscriptionPlanCode`, `ExecutionPackCode`) — structural identifiers for UI labels, images, DB records. Business data (prices, executions, display order, featured) comes exclusively from Stripe Product metadata.

### AI chat streaming
Provider abstraction (`AI_PROVIDER` → `AnthropicService`), SSE streaming через `res.write()`. Durable reservation pattern: `AiService.reserveChatRequest()` робить atomic `findOneAndUpdate` (balance + single-flight guard), потім stream, потім commit або refund. 2-layer protection: IP rate limit (Redis Lua) і atomic durable reservation (single-document Mongo op). Abort policy: refundable до першого токена, non-refundable після. Файл: `apps/api/src/modules/ai/ai.controller.ts`

### Reservation primitives (generic core API)
`UsersService.commitReservation()` — MongoDB transaction з claim-first порядком (active claim резервації перед side effects). `UsersService.refundReservation()` — single atomic `findOneAndUpdate`, що застосовує `compensationOps` зі збереженого reservation document. `ReservationReconcileService` — generic cron (кожні 5 хвилин), знаходить expired reservations і викликає той самий `refundReservation`. Будь-який feature, що мутує власні поля під час reserve, декларує compensation у `activeReservation.compensationOps`; core refund застосовує їх атомарно.

### Avatar upload pipeline (R2)
Provider abstraction (`STORAGE_PROVIDER` → `CloudflareR2Service`, S3-compatible SDK). Three-step client flow: `POST /storage/avatar/upload-url` → direct PUT до R2 → `POST /storage/avatar/commit`. API сервер ніколи не проксує файли. Presigned PUT URL підписує лише `Content-Type: image/webp` (клієнт мусить відправити рівно таке значення, інакше R2 → 403). Size enforcement на application layer: client pre-check → `HeadObject` при commit з `deleteObject` cleanup при rejection → throttler на presigned URL endpoint. Commit ідемпотентний: повторний виклик з тим самим fileKey повертає existing URL без повторного `safeDeleteR2File(oldUrl)` — захист від race при retry. File key формат: `avatars/{userId}/{uuid}.webp` (shared `AVATAR_FILE_KEY_REGEX` у `packages/types/src/contracts/storage.ts`). Client: `react-easy-crop` (round mask, pinch-zoom) → `canvas.toBlob('image/webp', 0.85)` → `uploadToR2()` (native `fetch`, не `apiClient`). HEIC свідомо **не підтримується**: будь-який browser-side HEIC-декодер транзитивно залежить від libheif (LGPL-3.0), що несумісне з permissive-ліцензійним профілем репо. iOS Safari ≥14 автоматично конвертує HEIC → JPEG при виборі файла, якщо `accept` не містить `image/heic`, тож iPhone UX зберігається без shipping'у декодера. Файл: `apps/api/src/modules/storage/storage.service.ts`.

### Google OAuth avatar re-upload
При Google OAuth callback (перший signup або legacy users з зовнішнім URL) `AuthService.handleGoogleAuth` **синхронно** викликає `StorageService.reUploadExternalAvatar()` (fetch Google URL → `sharp.resize(512×512, cover).webp({ quality: 85 })` → `uploadBuffer` у R2), мутує `user.profile.avatar` і `user.save()` — все перед `generateTokens`. UX trade-off: +300-800ms до callback, але без URL-jump після рендеру. Failure → `logger.warn` + fall through з external URL (наступний login повторить спробу). R2 URL detection для скіпа re-upload legacy-рейсів: prefix-check проти `ENV.R2_PUBLIC_URL`.

### Error handling та message mapping
API повертає machine-readable `code` через `AllExceptionsFilter`; web маппить codes на українські рядки через `shared/api/mapApiCode.ts` (`getApiMessage(code, module?, vars?)`). Додаток single-locale (uk only) — рядки інлайн, без catalog-файлів.

### Soft-delete lifecycle
Запит на видалення → `accountDeletionRequestedAt` + `deletedAt` → grace period (configurable) → `CleanupService` cron кожні 6 годин hard-delete + revoke tokens. Файл: `apps/api/src/modules/users/cleanup.service.ts`

### Frontend auth flow
`AuthInitializer` (client effect) → `refreshToken()` → `getMe()` → hydrate `authStore`. Перевіряє terms version, показує modal при outdated. `AuthGuard` компонент в protected layout перевіряє auth + onboarding completion. Middleware (`middleware.ts`) перевіряє `bid_refresh` cookie для server-side redirects.

### Overlay management
Zustand store → `UiModal`/`UiSheet`/`UiConfirmDialog` → реєстрація в `app/overlays.tsx` (єдиний global mount). Конвенція: `docs/conventions/overlays.md`. Кожен dialog store живе **усередині свого slice** (feature/widget), що ним володіє — глобального `src/stores/` шару не існує (enforced ESLint правилом `no-restricted-imports` + `no-restricted-syntax` в `apps/web/eslint.config.mjs`).

### FSD layer inversion via event bus
`shared/lib/authEvents` — parameterless lifecycle events для інверсії залежностей. Використовується коли нижчий шар (`shared/api`) потребує реакції від вищого шару (`entities/user/authStore` очищується при `'session-lost'`). Нижчий шар лише публікує; верхній підписується зі свого місця.

ESLint guardrail `SHARED_MUST_NOT_IMPORT_HIGHER_LAYERS` блокує прямі імпорти з shared/ у вищі FSD-шари (і для static `import`, і для dynamic `import()`).

### Execution ledger
Atomic `$inc` на `user.executions.balance` + створення `ExecutionTransaction` запису. Spend-ендпоінт перевіряє достатність балансу. AI chat також створює transaction з action `AI_CHAT`. Файл: `apps/api/src/modules/users/users.service.ts`

## API Overview

Global prefix: `/api`. Rate limiting: `ThrottlerModule` (60 req/min global). Global pipes: `ZodValidationPipe`. Global filters: `AllExceptionsFilter`.

### AppController (`apps/api/src/app.controller.ts`)
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| GET | `/` | — | Root endpoint |
| GET | `/health` | — | Health check + timestamp + env |

### AuthController (`apps/api/src/modules/auth/auth.controller.ts`)
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| GET | `/auth/google` | `AuthGuard('google')` | Старт Google OAuth |
| GET | `/auth/google/callback` | `AuthGuard('google')` | OAuth callback, set refresh cookie |
| POST | `/auth/check-email` | — | Перевірка існування акаунту (rate-limited) |
| POST | `/auth/login/password` | — | Вхід з паролем |
| POST | `/auth/magic-link/send` | — | Відправка magic link |
| POST | `/auth/magic-link/verify` | — | Верифікація magic link token |
| POST | `/auth/password/set` | `JwtActiveGuard` | Встановлення першого паролю |
| POST | `/auth/password/change` | `JwtActiveGuard` | Зміна паролю, revoke all tokens |
| POST | `/auth/password/reset` | — | Скидання паролю через magic link token |
| POST | `/auth/password/verify` | `JwtActiveGuard` | Перевірка паролю для sensitive дій |
| POST | `/auth/refresh` | — | Ротація refresh token (cookie) |
| POST | `/auth/logout` | — | Revoke refresh token |

### UsersController (`apps/api/src/modules/users/users.controller.ts`)
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| GET | `/users/me` | `JwtActiveGuard` | Профіль + billing snapshot |
| PATCH | `/users/me` | `JwtActiveGuard` | Оновлення профілю |
| POST | `/users/me/accept-terms` | `JwtActiveGuard` | Прийняття ToS версії |
| POST | `/users/me/executions/spend` | `JwtActiveGuard` | Витрата executions |
| GET | `/users/me/executions/transactions` | `JwtActiveGuard` | Історія транзакцій executions |
| POST | `/users/account/delete` | `JwtActiveGuard` | Запит на видалення |
| POST | `/users/account/delete/confirm` | `JwtActiveGuard` | Підтвердження видалення паролем |
| POST | `/users/account/restore` | `JwtAuthGuard` | Відновлення акаунту |

### PaymentsController (`apps/api/src/modules/payments/payments.controller.ts`)
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| GET | `/payments/catalog` | — + `@SkipOnboarding()` | Product catalog (from Stripe, cached) |
| POST | `/payments/checkout-session` | `JwtActiveGuard` | Створення Stripe checkout |
| POST | `/payments/portal-session` | `JwtActiveGuard` | Створення billing portal URL |
| POST | `/payments/reset` | `JwtActiveGuard` | Скидання billing (видалення Stripe customer) |
| POST | `/payments/webhook/:provider` | — + `@SkipThrottle()` | Stripe webhook ingestion |

### AiController (`apps/api/src/modules/ai/ai.controller.ts`)
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| POST | `/ai/chat` | `JwtActiveGuard` + `AiRateLimitGuard` | SSE streaming chat (execution cost: 200) |
| GET | `/ai/chat/history` | `JwtActiveGuard` | Історія повідомлень чату |
| DELETE | `/ai/chat/history` | `JwtActiveGuard` | Очищення історії чату |

### StorageController (`apps/api/src/modules/storage/storage.controller.ts`)
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| POST | `/storage/avatar/upload-url` | `JwtActiveGuard` | Presigned PUT URL для direct R2 upload (Content-Type signed, 5-min TTL) |
| POST | `/storage/avatar/commit` | `JwtActiveGuard` | Verify metadata (HeadObject) + update profile.avatar + delete old R2 file |
| DELETE | `/storage/avatar` | `JwtActiveGuard` | Clear profile.avatar + delete R2 file |

### Reports
Scaffold без ендпоінтів.

## Configuration & Environment

**Loaders**
- API: `apps/api/src/config/env.ts` (fail-fast, crash on missing)
- Web: `apps/web/src/shared/config/env.ts` (direct `process.env.VAR` для Next.js inlining)
- Шаблон: `.env.example`
- Політика: `docs/conventions/fail-fast.md`

**API — ALL required (crash if missing, no defaults)**
- `NODE_ENV`, `PORT`, `WEB_URL`
- `MONGODB_URI`, `REDIS_URL`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- `PAYMENTS_SUBSCRIPTION_ENABLED`, `PAYMENTS_ONE_OFF_ENABLED` (хоча б один `true`)
- Auth tuning: `AUTH_PASSWORD_MIN_LENGTH`, `AUTH_LOCKOUT_THRESHOLDS`, `AUTH_LOGIN_ATTEMPTS_TTL_MIN`, `AUTH_MAGIC_LINK_TTL_MIN`, `AUTH_MAGIC_LINK_RATE_LIMIT`, `AUTH_MAGIC_LINK_RATE_WINDOW_MIN`, `AUTH_MAGIC_LINK_DEDUP_SEC`, `ACCOUNT_DELETION_GRACE_DAYS`
- AI: `ANTHROPIC_API_KEY`, `AI_CHAT_MAX_TOKENS`, `AI_CHAT_IP_LIMIT`
- Storage (R2): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` (hostname частина мусить збігатись з `NEXT_PUBLIC_STORAGE_HOSTNAME` на web — див. Known Complexities)

**Web — ALL required (crash if missing)**
- `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_PAYMENTS_SUBSCRIPTION_ENABLED`, `NEXT_PUBLIC_PAYMENTS_ONE_OFF_ENABLED`
- `NEXT_PUBLIC_STORAGE_HOSTNAME` — R2 CDN hostname (використовується `next/image` `remotePatterns`; `next.config.ts` fail-fast'ить при його відсутності)

**Web — optional**
- `API_INTERNAL_URL` — server-side reverse proxy target (rewrites в `next.config.ts`)

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
pnpm --filter @finly/types build                  # rebuild shared types

pnpm --filter api -- jest path/to/file.spec.ts        # один API тест
pnpm --filter web -- jest path/to/file.test.ts        # один Web тест

docker compose -f docker-compose.dev.yml up --build   # dev (Redis only)
docker compose up --build -d                          # prod-like
```

## Testing Strategy

- API unit specs: `apps/api/src/**/*.spec.ts` (поруч з модулями)
- API e2e: `apps/api/test/*.e2e-spec.ts` (MongoMemoryServer + provider overrides)
- Web: Jest + jsdom, поруч з source файлами
- Test env setup: `apps/api/src/test-setup.ts` — fallback env vars для unit тестів (placeholder values через `??=`, запобігає fail-fast crash)
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
- Читай перед роботою з відповідними зонами: `tone.md`, `fail-fast.md`, `modular-boundaries.md`, `ui-primitives.md`, `design-tokens.md`, `overlays.md`
- **Manual checks (UAT-чекліст):** `docs/manual-checks/README.md` — єдиний реєстр перевірок, що неможливо автоматизувати (зчитування QR живими банк-додатками, рендер на маленьких екранах, друк на папері тощо). Файл ведеться **навмисно простою мовою без термінів** — додаючи туди нові пункти, дотримуйся цього стилю. Тестова логіка спринта мусить додавати сюди новий пункт, якщо вона включає сценарій, який unit-тести в принципі не можуть закрити.

## Known Complexities

- **rawBody для Stripe**: `NestFactory.create(AppModule, { rawBody: true })` в `main.ts` — без цього signature verification ламається. Webhook endpoint використовує `RawBodyRequest`.
- **AuthModule ↔ UsersModule circular**: обидва імпортують один одного через `forwardRef`. Порушення цього патерну = Nest DI crash.
- **Refresh token rotation atomic**: `GETDEL` в Redis забезпечує single-use. Reuse detection (missing key) тригерить повний revoke всіх токенів користувача (security measure). Grace period 10s для concurrent tabs.
- **Out-of-order webhooks**: Subscription billing updates використовують `lastProviderEventAt` guard в MongoDB atomic query (`$lt`, не `$lte`). Старіші events тихо пропускаються. Це НЕ баг.
- **Refresh cookie працює через proxy**: `next.config.ts` проксує `/api/*` на backend — тому `bid_refresh` cookie (httpOnly) видимий і в middleware, і в API (same origin).
- **`test-setup.ts` fallback env**: Без цього файлу fail-fast policy крашить Jest ще до запуску тестів. Використовує `??=` оператор — не перезаписує реальні env vars.
- **`packages/types` build order**: Має бути зібраний ДО `apps/api` та `apps/web`. Turborepo `dependsOn: ["^build"]` це забезпечує, але manual build без turbo зламається.
- **Single-locale (uk only)**: продукт — українською без перемикача мов. Email-тексти інлайн у `apps/api/src/modules/email/translations.ts` (`EMAIL_TEXT`); `<Html lang="uk">` як константа в `BaseLayout`; `formatDate` хардкод `'uk-UA'`. Web-рядки інлайн у JSX/компонентах. Усі URL без локаль-префікса (`/billing`, `/auth/signin`, тощо). Якщо колись треба буде повернути локалізацію — це окрема велика міграція, не одна правка прапорця.
- **Webhook route dynamic provider**: URL шаблон `/webhook/:provider`, але наразі підтримується тільки `stripe`. Невідомий provider тихо відхиляється.
- **Orphaned customer retry cap**: `PaymentsCleanupService` робить максимум 5 спроб видалити Stripe customer. Після 5 невдач запис залишається в колекції назавжни — потребує ручного втручання.
- **CatalogService own Stripe instance**: `CatalogService` створює власний `new Stripe(...)` для читання Products/Prices. Це зроблено щоб уникнути circular DI з `IPaymentProvider` → `StripeService`. Обидва інстанси використовують один `STRIPE_SECRET_KEY`.
- **Catalog cache startup**: `CatalogService.onModuleInit()` робить warm fetch до Stripe. Якщо Stripe недоступний при старті — app crash (fail-fast). Після старту cache fallback працює через Redis TTL.
- **Execution proration на plan change**: `calculatePlanChangeAdjustment()` в `PaymentsService` рахує пропорцію залишку періоду для коригування executions при upgrade/downgrade. Використовує `previousPriceId` з webhook event та `getPriceToExecutionsMap()` з CatalogService.
- **AI chat SSE після headers**: Після `res.flushHeaders()` помилки більше не можуть бути HTTP errors — йдуть як SSE events з типом `ERROR`. Reservation (`reserveChatRequest`) відбувається ДО встановлення SSE headers — будь-яка 4xx помилка (balance, limit, active reservation) йде як звичайний HTTP error.
- **AI chat durable reservation**: Reserve (atomic `findOneAndUpdate`, без транзакції) → stream → commit (MongoDB transaction, claim-first) або refund (atomic single-doc op). Abort policy: refundable до першого токена, non-refundable після. `ReservationReconcileService` cron — generic safety net для crash-window (кожні 5 хвилин).
- **Redis atomic counters via Lua**: `RedisCounterService` використовує `redis.eval()` Lua scripts для atomicity. Fixed-window: TTL тільки при першому increment. Sliding-window: TTL оновлюється при кожному increment. Обидва повертають post-increment count.
- **Reservation compensation pattern**: `activeReservation.compensationOps` зберігає `$inc` операції, які core `refundReservation` застосовує атомарно. Cron-reconciler повністю generic — не знає про feature-specific поля. Для AI зараз `{ inc: {} }` (executions-only); якщо feature почне мутувати власні поля під час reserve, відповідні `$inc`-компенсації декларуються тут.
- **Presigned PUT signs Content-Type only**: лише `Content-Type` підписується. `Content-Length` НЕ підписується навмисно — це forbidden request header у Fetch (браузер встановлює автоматично з blob body), а signed `ContentLength` у PUT — це exact-match, не upper bound. Клієнт мусить відправити `Content-Type: image/webp` рівно таке саме, що підписав бекенд, інакше R2 → 403 `SignatureDoesNotMatch`.
- **Avatar size enforcement на application layer**: upper-bound контроль через три шари — client-side pre-check, commit-time `HeadObject` валідація з `deleteObject` cleanup при rejection, global `ThrottlerGuard` на presigned URL endpoint. Attack surface: authenticated user може тимчасово upload'ити oversized файл у свій namespace, але commit одразу зловить і видалить. Для великих/публічних media-типів у майбутньому — міграція на presigned POST з `content-length-range` policy.
- **R2 URL detection для safe delete**: `StorageService.isR2Url()` — prefix-check проти `ENV.R2_PUBLIC_URL`. Зовнішні URL (наприклад, legacy Google `lh3.googleusercontent.com`) пропускають R2 delete без помилки.
- **Commit idempotency**: повторний `commitAvatarUpload` з тим самим fileKey (мережевий retry) повертає existing URL без повторного `safeDeleteR2File(oldUrl)` — без цього guard второй виклик видалив би щойно збережений файл (`oldUrl` == актуальний URL).
- **Storage error mapping contract**: всі raw SDK/network/sharp помилки у avatar pipeline (`generatePresignedUploadUrl`, `getObjectMetadata`, `uploadBuffer`, `fetch`, `response.arrayBuffer`, `sharp`) обгорнуті в `mapStorageError()` helper → `InternalServerErrorException({ code: AVATAR_UPLOAD_FAILED })`. Структуровані `HttpException` з власним кодом (AVATAR_UPLOAD_INVALID тощо) пропускаються untouched.
- **Orphaned R2 files trade-off**: upload без commit залишає файл у `avatars/{userId}/`. На MVP acceptable (після crop+WebP ~50-200 KB, R2 storage $0.015/GB/міс). На scale — TTL cron або lifecycle policy.
- **R2 public URL ↔ web hostname invariant**: `R2_PUBLIC_URL` hostname (backend) МУСИТЬ дорівнювати `NEXT_PUBLIC_STORAGE_HOSTNAME` (web). Не збігаються → `next/image` блокує завантажені фото runtime. `next.config.ts` fail-fast'ить при відсутності `NEXT_PUBLIC_STORAGE_HOSTNAME` — hard build failure краще за silent omit.
- **Sharp на Alpine Docker**: sharp 0.33+ підтягує prebuilt libvips для Linux musl автоматично через `optionalDependencies` — `node:20-alpine` працює без правок Dockerfile у стандартному випадку. Якщо prebuilt недоступний (рідкісні архітектурні edge cases) — fallback `apk add --no-cache vips` у runtime stage. Верифікувати локальним build + `node -e "require('sharp')"` у контейнері.
- **OAuth callback sync re-upload**: `AuthService.handleGoogleAuth` викликає `reUploadExternalAvatar` **синхронно** перед видачею токенів. Додає 300-800ms до callback, але уникає UX-стрибка URL (async варіант спричинив би показ Google URL до першого refresh). Failure non-critical: `logger.warn` + fall through з external URL, наступний login повторює спробу.
