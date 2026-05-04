# Finly

> **Product vision (finly.com.ua):** SaaS для українських ФОП та їх бухгалтерів — генерація платіжних QR-кодів і посилань за стандартом НБУ, щоб клієнти сканували й оплачували без ручного введення реквізитів. У планах — зберігання документів із AI-тегуванням для швидкого пошуку.
>
> **Поточний стан репозиторію:** monorepo-monolith на Next.js 16 + NestJS 11. Реалізовано: тех-фундамент (auth/session lifecycle, billing Stripe, executions ledger, AI chat Anthropic, avatar storage R2), pure NBU payload-builder (формати 002/003), QR image-render pipeline, Business domain + cabinet CRUD, public payment-сторінка `pay.finly.com.ua/{slug}` через host-aware routing з real NBU app-link CTA. Заплановано (Sprint 4+): інвойси під бізнесом, per-bank deep-links, Free/Paid гейти, document storage з AI-tagging. Shared Zod/TypeScript контракти використовуються обома застосунками.

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
│   ├── modules/         # auth, email, users, payments, ai, reports, storage, businesses, qr, invoices
│   └── ../scripts/migrations/   # one-shot DB migrations + spec (npm: migration:slug-lower)
├── web/src/
│   ├── app/             # pages: root, auth, (protected), host-pay/[slug], privacy, terms (single-locale, uk only)
│   │   └── (protected)/business, business/[slug], business/new   # cabinet (§3.5–3.8)
│   ├── entities/        # user (authStore), navigation (headerNavStore), brand (Logo)
│   ├── features/        # auth, billing, profile, change-theme, business-edit, business-wizard, business-public — own their dialog/state stores in-slice
│   ├── widgets/         # header (mobileMenuSheetStore)
│   └── shared/          # api, ui, config (env, publicHosts), styles, icons, seo, lib, fonts, types
packages/
└── types/src/           # contracts, entities, enums, constants, validation, utils, qr
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

### Business
Файл: `apps/api/src/modules/businesses/schemas/business.schema.ts` | Zod: `packages/types/src/entities/business.ts`
- `type` (enum: `'fop'`; ТОВ/ВАТ — Phase 1.5+), `name`, `requisites: { iban, taxId }`, `paymentPurposeTemplate`, `acceptedBanks: BankCode[]`
- **`taxationSystem`** (enum `simplified-1/2/3 | general`) + **`isVatPayer`** (bool, default false) — coupled-rule (Sprint 3 §C1): `isVatPayer === true ⇒ taxationSystem ∈ {simplified-3, general}`. Refine у Zod entity + write-DTO + service-layer cross-field check для partial PATCH (читає БД при необхідності).
- **`slug`** (case-preserved display, regex `[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*`) + **`slugLower`** (lowercase normalised). Unique-index на `slugLower` (case-insensitive uniqueness, Sprint 3 §E1). Reserved-list check (`packages/types/src/constants/reserved-slugs.ts`, 5 категорій ~200 імен включно з `host-pay`) — slug-генератор `apps/api/src/modules/businesses/slug-generator.service.ts` (8-char A-Za-z0-9, max 10 retries, crypto.randomBytes).
- **`seoIndexEnabled`** (bool, default false) — toggle публікації у пошуковики (Sprint 3 §E3); public Server Component читає для `<meta name="robots">`.
- **`ownerId`** (`ObjectId | null`) + **`managers: ObjectId[]`** — null-owner режим бухгалтера (рішення E5); інваріант `ownerId === null ⇒ managers.length ≥ 1` у Zod refine.
- `deletedAt: Date | null` — навмисно невикористане (Sprint 3 §C2 робить hard-delete; поле залишене на майбутнє без міграції).
- Sparse indexes: `ownerId`, `managers`; unique: `slugLower`.

## Module Dependency Map

- `AppModule` → `AuthModule`, `EmailModule`, `UsersModule`, `PaymentsModule`, `ReportsModule`, `StorageModule`, `AiModule`, `QrModule`, `BusinessesModule`, `InvoicesModule`
- `AppModule` global providers: `ThrottlerGuard` (APP_GUARD), `OnboardingInterceptor` (APP_INTERCEPTOR)
- `AuthModule` ↔ `UsersModule` (`forwardRef`, circular)
- `AuthModule` → `StorageModule` (for Google avatar re-upload у `handleGoogleAuth`)
- `EmailModule` — `@Global()`, доступний всім модулям
- `RedisModule` — `@Global()`, exports `REDIS_CLIENT` token + `RedisCounterService` (Lua-based atomic counters)
- `PaymentsModule` → `UsersModule` + `PAYMENT_PROVIDER` injection token + `CatalogService` + `REDIS_CLIENT`
- `CatalogService` → own Stripe SDK instance + `REDIS_CLIENT` (no dependency on `IPaymentProvider`)
- `AiModule` → `UsersModule` + `REDIS_CLIENT` + `AI_PROVIDER` injection token (AnthropicService)
- `StorageModule` → `UsersModule` + `STORAGE_PROVIDER` injection token (CloudflareR2Service); exports `StorageService` (consumed by `AuthModule`)
- `BusinessesModule` → `MongooseModule.forFeature(Business)` + `QrModule` + `UsersModule`; exports `BusinessesService` + `MongooseModule` (для Sprint 4 `InvoicesModule`)
- `InvoicesModule` — Sprint 1 scaffold: тільки `MongooseModule.forFeature(Invoice)` + re-export. Без controller/service до Sprint 4 (там додається CRUD під бізнесом, slug-генератор reuse-ить `BusinessesModule.SlugGeneratorService` через DI, edit-картки переюзають `EditableField` з `features/business-edit`)
- `QrModule` exports `QrService` (`buildNbuPayloadLinkForInput` + `renderForUrl` + `renderForNbuPayload`); консумується `BusinessesModule.PublicBusinessesController`
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

### QR generation pipeline
Pure NBU payload-builder (formats 002 і 003 за постановою НБУ № 97 від 19.08.2025) живе у `@finly/types/src/qr/` — host-agnostic, без Node-залежностей: `build002Payload` / `build003Payload` → `encodePayloadAsBase64Url` (isomorphic, без `Buffer`) → `buildNbuPayloadLink(version, b64, { host })`. Payload validates input через `PayloadInputSchema` (re-uses `ibanZod` + `individualTaxIdZod` зі Sprint 1) + per-field char/byte length asserts (`FIELD_LIMITS`) + NBU charset whitelist (`_charset.ts` — Win1251-mapping без control chars/LF/CR/emoji) + payload-overall ≤ 507 B + Base64URL frame ≤ 475 B. Sprint 1 Zod-схеми (`Business.name`, `Business.paymentPurposeTemplate`, `Invoice.paymentPurpose`) деривують свої max-довжини через `effectiveLimit(...)` = MIN по `PAYLOAD_VERSIONS` — інваріант "save → render завжди працює". Image-render у NestJS-модулі `apps/api/src/modules/qr/`: `QrImageRenderer` (qrcode → PNG, error-correction `Q` за нормативом 003) + `QrLogoCompositor` (sharp overlay нормативного asset-а зі знаком ₴, `logoMaxRatio ≤ 0.20` під Q-correction 25% надлишковості) + `QrService` orchestrator з двома методами — `renderForUrl(url)` (для публічної сторінки `pay.finly.com.ua/{slug}`) і `renderForNbuPayload(input, version, options)` (повний build → encode → wrap → render flow). **Host для format 003 — required-параметр `options.host`** (Sprint 3 рішення A2: жодного env, дві named-константи `NBU_HOST_PRIMARY = 'qr.bank.gov.ua'` і `NBU_HOST_LEGACY = 'bank.gov.ua/qr'` у `packages/types/src/qr/url-prefix.ts`); public-сторінка викликає `renderForNbuPayload` двічі, по одному разу з кожним host-ом, і показує дві кнопки + два QR — клієнт сам пробує, якщо одна не спрацювала. Format 002 host фіксований нормативом (`URL_PREFIX_002`) — параметр ігнорується. TypeScript-overload блокує виклик `renderForNbuPayload(..., '003', ...)` без host. Файл: `apps/api/src/modules/qr/qr.service.ts`. Round-trip тест через `jsqr` (devDep) у `qr.service.integration.spec.ts` гарантує, що згенерований PNG зчитується назад у вихідний payload з нормативним центральним asset-ом.

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

### BusinessesController (`apps/api/src/modules/businesses/businesses.controller.ts`)
Cabinet zone — slug як primary route-param (не `:id`); resolved через `slugLower` unique-index.
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| GET | `/businesses/me` | `JwtActiveGuard` | Список бізнесів (filter залежить від `worksAsBookkeeper` toggle) |
| POST | `/businesses/me` | `JwtActiveGuard` | Створення (4-step wizard надсилає одним POST). Slug сервер генерує. Response містить canonical slug — frontend `router.replace('/business/{slug}')` |
| GET | `/businesses/me/:slug` | `JwtActiveGuard` + `BusinessAccessGuard` | Повний об'єкт бізнесу для кабінету (case-insensitive lookup) |
| PATCH | `/businesses/me/:slug` | `JwtActiveGuard` + `BusinessAccessGuard` | Часткове оновлення; `.strict()` блокує slug/type/ownership mutation. Coupled VAT × taxationSystem cross-field перевірка читає БД при partial-update |
| DELETE | `/businesses/me/:slug` | `JwtActiveGuard` + `BusinessAccessGuard` | Hard-delete (slug звільняється одразу) |

### PublicBusinessesController (`apps/api/src/modules/businesses/public-businesses.controller.ts`)
Public zone (`pay.finly.com.ua`) — без auth, без cookie. `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`.
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| GET | `/businesses/public/:slug` | — + `@SkipOnboarding()` | 6 whitelist-полів (type, name, slug, acceptedBanks, seoIndexEnabled, **nbuLinks: {primary, legacy}**); реквізити не leak-нуто JSON-ом, але присутні у nbuLinks через Base64URL payload (той самий vector як QR PNG) |
| GET | `/businesses/public/:slug/qr/business.png` | — | QR на public URL (`{PAY_PUBLIC_URL}/{slug}`); знак гривні в центрі |
| GET | `/businesses/public/:slug/qr/nbu.png?host=primary\|legacy` | — | QR з NBU-payload-link (формат 003) на одну з двох норматив-allowed адрес |

### Reports
Scaffold без ендпоінтів.

## Configuration & Environment

**Loaders**
- API: `apps/api/src/config/env.ts` (fail-fast, crash on missing)
- Web: `apps/web/src/shared/config/env.ts` (direct `process.env.VAR` для Next.js inlining)
- Шаблон: `.env.example`
- Політика: `docs/conventions/fail-fast.md`

**API — ALL required (crash if missing, no defaults)**
- `NODE_ENV`, `PORT`, `WEB_URL` (cabinet origin), `PAY_PUBLIC_URL` (public payment-page origin — host для QR на публічну вивіску бізнесу)
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
- Читай перед роботою з відповідними зонами: `tone.md`, `fail-fast.md`, `modular-boundaries.md`, `ui-primitives.md`, `design-tokens.md`, `overlays.md`, `responsive.md`
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
- **QR field separator semantics**: payload — рядки розділені `\n` (Lf). **Trailing-empty fields обовʼязкові** (002 — точно 13 полів, 003 — точно 17; навіть RFU/Оп.-empty представлені порожнім рядком). Без цих trailing полів payload коротший на одне поле і банк-парсер відхиляє QR. `FIELD_ORDER` всередині `build002Payload`/`build003Payload` фіксує точну довжину масиву — guarantee enforced builder-ом, не caller-ом.
- **QR UTF-8 bytes vs chars**: норматив НБУ оперує `B` (bytes) для одних полів і `C` (chars) для інших. JS `.length` рахує UTF-16 code units (≈ chars). Cyrillic у UTF-8 — 2 bytes, апостроф `'` U+2019 — 3 bytes, emoji — 4 bytes. Без розрізнення legitimate ФОП-кейс (`ТОВ \"Кав\'ярня\"`) мовчки переповнить byte-limit. `assertWithinUtf8Limits` у `packages/types/src/qr/limits.ts` тримає окремі `chars`/`bytes` ліміти + `utf8ByteLength` як shared isomorphic helper для Zod refines у entity-схемах і builder.
- **QR error-correction `Q` під лого, не `H`**: норматив 003 (Додаток 4 §IV.10.4) явно дозволяє лише `M` або `Q` (без `H`). Sprint plan §2.3 початково пропонував `H` під 30%-ratio, але це non-compliant з 003. Дефолт у `QrService` — `Q` (~25% надлишковості) + `logoMaxRatio ≤ 0.20` (safe upper-bound у quadrant'і під 25%). `QrLogoCompositor` робить hard guard на `0.20` — за межею throw `QR_LOGO_TOO_LARGE`. Деталі — `docs/product/qr-spec/diff-002-003.md`.
- **QR fieldLockMask bit-numbering**: bit N (1-indexed у нормативі) → bit-pos N (0-indexed у JS), не bit-pos N-1. Це підтверджується нормативним прикладом `FEFF` "поле 8 → editable" (FEFF binary має bit-pos 8 = 0). Required-locked mask = `0xC83E` (поля 1-5 + 11 + 14-15; поля 16-17 поза 16-bit mask). `INVALID_FIELD_LOCK_MASK_REQUIRED_BITS` ловиться Zod `.refine`. Деталі — `docs/product/qr-spec/README.md` "Поле 14".
- **QR Base64URL frame ≤ 475 B vs raw ≤ 507 B**: норматив декларує обидва ліміти, але вони математично перетинаються — 475 b64url chars ↔ ~356 raw bytes, тобто 475-ліміт фактично restrictive за 507. `buildNbuPayloadLink` асертить b64url-довжину **до** host-валідації (overflow важливіший за typo). Builder додатково assert'ить raw payload ≤ 507 — defense-in-depth.
- **QR sharp import у ts-jest**: ts-jest має interop bug з `sharp` default-export (`(0, sharp_1.default) is not a function`). Production `nest build` (tsc) працює коректно. У `qr-logo.compositor.ts` і `qr.service.integration.spec.ts` використовується TS-style `import sharp = require('sharp')` — канонічна форма для callable CJS у TS. `storage.service.ts` залишає default-import, бо його тести мокають sharp повністю.
- **QR asset shipping**: `apps/api/src/modules/qr/assets/hryvnia-symbol.png` (нормативний asset за §II.11–12 PDF постанови НБУ № 97 — білий круг зі знаком ₴) копіюється у `dist/modules/qr/assets/` через `nest-cli.json` `compilerOptions.assets` (glob `modules/qr/assets/**/*`). `QrService` резолвить шлях через `__dirname` — однаково працює і в dev (ts-node), і в prod (compiled `dist/`). Reproducibility-генератор asset-а — `apps/api/scripts/generate-hryvnia-asset.ts`. Custom-logo бізнесу замість гривні — Sprint 6 (Paid фіча); `QrLogoCompositor` параметризований через `logoPath: string` для легкого розширення.
- **Slug case-preserved + uniqueness on lower (Sprint 3 §E1)**: Twitter/Instagram-style. Display-форма (`Business.slug`) — як зафіксував ФОП (`IvanEnko`); lookup і uniqueness на `slugLower` (Mongoose unique-index `{slugLower: 1}`). Reserved-перевірка на lowercase. **308 Permanent Redirect** на canonical case при URL mismatch (Next.js `permanentRedirect` у Server Component → `host-pay/[slug]/page.tsx`; `/dashboard` → `/business` legacy bookmark теж 308 у middleware). Manual UAT — `docs/manual-checks/README.md` PUB-5. Free random retry: 8-char `A-Za-z0-9`, max 10 attempts, потім `SLUG_GENERATION_FAILED`. Migration `2026-05-03-businesses-slug-lower.ts` дропає старий `{slug:1}_unique`, backfill-ить `slugLower=$toLower($slug)`, створює новий — idempotent, fail-safe на duplicate-key (case-vary legacy → manual rename).
- **Hard-delete з frontend-only 5s Undo (Sprint 3 §C2 §F8)**: жоден API call поки 5 секунд не минули. **Timer ID живе у closure**, не у React ref — cabinet page розмонтовується через optimistic redirect (`router.replace('/business')`), а cleanup-effect із clearTimeout вбив би timer до спрацювання; sonner toast queue живе у root layout, не unmount-иться. Browser-unload (window kill) автоматично вб'є setTimeout — implicit cancel без explicit cleanup. `pendingDeletesStore` (Zustand) ховає slug з list UI синхронно при scheduling; на success **slug залишається** у store до browser-unload (інакше stale local `items[]` re-show-нув би видалений запис). Backend transient flag навмисно відкинутий — `setTimeout` у Node не переживає рестарт і не працює multi-instance.
- **Bookkeeper-toggle тільки UI-фільтр (Sprint 3 §E5)**: ownership-bit на user-документі (`worksAsBookkeeper`). Перемикання не мутує жодного бізнесу — лише фільтрує `getOwnedAndManaged` query (bookkeeper ON → ownerless+managers; OFF → owned). Sprint 3 toggle доступний усім без Paid-gating; Sprint 6 додасть guard через frontend модалку "Доступно на Paid". Frontend optimistic update + rollback на error через `mapApiCode` toast.
- **Public endpoint whitelist + nbuLinks vector (Sprint 3 §C4 + §A2)**: 6 полів — `type`, `name`, `slug`, `acceptedBanks`, `seoIndexEnabled`, `nbuLinks: {primary, legacy}`. Реквізити (IBAN, ІПН) **не** віддаються JSON-ом напряму, але присутні у `nbuLinks` через Base64URL-encoded NBU payload (той самий vector як QR PNG endpoint — payload-link і QR кодують ті самі дані). Whitelist інваріант: дані доступні **тільки через формати, що читаються банком як платіжна команда**, не raw для довільного scraping-у. `PublicBusinessSchema.parse()` strip-ає leak-fields на serialization step.
- **host-aware routing на одному Next.js project (Sprint 3 §A1 + §3.9)**: cabinet (`finly.com.ua`) і public (`pay.finly.com.ua`) ділять той самий Next.js container. Middleware має 3 branches: A (public+root-slug → rewrite на internal `/host-pay/{slug}`); B (public+non-root → 404); C (cabinet+`/host-pay/` → 404, direct-URL-attack захист). Host comparison **case-insensitive** за RFC 7230 §2.7 (`isPublicHost` lowercases input) — strict-eq ламав би host-isolation на UPPER/mixed case. Reserved-slug check у Branch A — захист від рекурсивного rewrite на `/host-pay/host-pay`. Cookie isolation: `bid_refresh` ставиться на cabinet host без `Domain=` атрибуту → invisible на pay-host. Server Component `app/host-pay/[slug]/page.tsx` робить defense-in-depth host check через `headers()` — middleware-config drift не призводить до leak public сторінки на cabinet host. ISR `revalidate: 60` — баланс свіжості і навантаження на API (узгоджується з public endpoint `Cache-Control: max-age=3600`).
