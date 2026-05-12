# Finly

> **Product vision (finly.com.ua):** SaaS для українських ФОП та їх бухгалтерів — генерація платіжних QR-кодів і посилань за стандартом НБУ, щоб клієнти сканували й оплачували без ручного введення реквізитів. У планах — зберігання документів із AI-тегуванням для швидкого пошуку.
>
> **Поточний стан:** monorepo-monolith Next.js 16 + NestJS 11. Реалізовано: auth/session lifecycle, billing Stripe, executions ledger, AI chat Anthropic, avatar storage R2, pure NBU payload-builder (формати 002/003), QR image-render pipeline, **трирівнева доменна модель Business → Account → Invoice** (Sprint 9): кабінет CRUD на кожному рівні, host-aware матрьошкова public-навігація `pay.finly.com.ua/{businessSlug}/{accountSlug}/{invoiceSlug}` з 307-redirect-at-1-Account, anon QR-preview-лендінг. Заплановано (Sprint 5+): per-bank deep-links, Free/Paid гейти, anon claim-flow refactor (Sprint 10), deep-link recovery (Sprint 11), orphan-business cleanup (Sprint 12), document storage з AI-tagging. Shared Zod/TypeScript контракти (`@finly/types`) використовуються обома застосунками.

## Tech Stack

| Шар        | Технологія                                                     | Версія                                       |
| ---------- | -------------------------------------------------------------- | -------------------------------------------- |
| Core       | TypeScript, Node.js, pnpm, Turborepo                           | TS 5.9, Node 20, pnpm 10.30                  |
| Frontend   | Next.js (App Router + Turbopack), React, Zustand, TailwindCSS  | Next 16.0, React 19.2, Zustand 5, Tailwind 4 |
| Forms      | React Hook Form + @hookform/resolvers (Zod)                    | RHF 7.72                                     |
| Backend    | NestJS, Mongoose, ioredis, Passport                            | NestJS 11.1, Mongoose 8                      |
| Validation | Zod (shared contracts)                                         | Zod 4.3                                      |
| AI         | Anthropic SDK (Claude Haiku 4.5)                               | SDK 0.80                                     |
| Payments   | Stripe                                                         | 20.4                                         |
| Email      | Resend + React Email                                           | 6.9                                          |
| Storage    | Cloudflare R2 (S3 SDK + presigner), `sharp`, `react-easy-crop` | SDK 3, sharp 0.34                            |
| QR         | `qrcode`, `sharp` (logo overlay)                               | qrcode 1.5                                   |
| Тести      | Jest, Supertest, MongoMemoryServer, @testing-library/react     | Jest 30.2                                    |

## Architecture Overview

Monorepo з трьома workspace: `apps/api`, `apps/web`, `packages/types`. API — system of record для auth, session lifecycle, billing, executions, AI chat, media storage, businesses, accounts та invoices; web — тонкий клієнт, що спілкується з API через shared Zod контракти. Frontend — Feature-Sliced Design. Cabinet (`finly.com.ua`) і public payment-page (`pay.finly.com.ua`) ділять один Next.js project через host-aware middleware з 3-сегментним матрьошковим routing-ом (Sprint 9). Модуль `reports` (API) — scaffold/placeholder.

## Project Structure

```
apps/
├── api/
│   ├── src/
│   │   ├── main.ts, app.module.ts, app.controller.ts
│   │   ├── config/          # fail-fast env loader
│   │   ├── common/          # decorators, filters, guards, interceptors, modules (Redis), services
│   │   └── modules/         # auth, email, users, payments, ai, reports, storage, businesses, accounts, invoices, qr
│   └── scripts/
│       ├── generate-hryvnia-asset.ts
│       └── migrations/      # one-shot DB migrations + spec (npm: migration:slug-lower)
├── web/src/
│   ├── app/                 # pages: root (anon QR-preview landing), auth, (protected), host-pay/[slug]/[accountSlug]/[invoiceSlug], privacy, terms (single-locale, uk only)
│   │   └── (protected)/     # ai-chat, billing, business/[slug]/account/[accountSlug]/invoice/[invoiceSlug], profile (layout = Header + ClaimLandingDraftHook + AuthGuard)
│   ├── entities/            # user (authStore), navigation (headerNavStore), brand (Logo), business (taxIdField), qr-landing-draft (Sprint 8 anon persist)
│   ├── features/            # auth, billing, profile, change-theme, business-edit, business-wizard, business-public, account-create, account-edit, account-public, invoice-create, invoice-edit, invoice-public, qr-landing-preview
│   ├── widgets/             # header (mobileMenuSheetStore), landing-hero
│   ├── shared/              # api, ui, config (env, publicHosts), styles, icons, seo, lib, fonts, types
│   └── middleware.ts        # host-aware routing (Branch A1/A2/A3/B/C) + cabinet auth-cookie checks
packages/
└── types/src/               # constants, enums, entities, contracts, validation, utils, qr
docs/
├── conventions/             # source-of-truth правила
├── manual-checks/           # UAT-чекліст (живі банк-додатки, друк, малі екрани)
├── product/                 # business-flow, qr-decisions, qr-spec, tech-backlog
└── sprints/                 # 01-foundation, 02-qr-core, 03-cabinet-public, 04-invoices, 07-payer-types, 08-public-qr-preview, 09-accounts
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

- `type` (enum `'individual' | 'fop' | 'tov' | 'organization'` — Sprint 7 §SP-1; **immutable post-creation**, §SP-8). `BUSINESS_TYPE_LABEL` у `@finly/types/enums/business-type.ts` дає UA-label per type. Декартова крос-таблиця 2×2: `(taxId-формат: 10-РНОКПП \| 8-ЄДРПОУ) × (оподаткування: comm \| non-comm)` → 4 значення. Підтипи (ПрАТ, ОСББ-vs-фонд) — НЕ окремі enum-значення, а підмножини `'tov'` / `'organization'`
- `name`, **top-level `taxId`** (Sprint 9 §SP-1 — flatten-ув `requisites`-wrapper; `iban` переїхав на окрему сутність `Account`), `paymentPurposeTemplate`, `acceptedBanks: BankCode[]`
- `taxId: string` — **single string у БД, format per-type на write-DTO** (Sprint 7 §SP-4 + Sprint 9 §SP-1 flatten): 10-цифровий РНОКПП + checksum для `individual` / `fop`, 8-цифровий ЄДРПОУ без checksum для `tov` / `organization`. Discriminator-таблиця у `validation/tax-id.ts` (`TAX_ID_VALIDATOR_BY_TYPE`); helper `taxIdLengthFor(type): 8 \| 10` для UI maxLength. Refine `TAX_ID_FORMAT_MISMATCH_TYPE` на entity з path `['taxId']`
- `taxationSystem: TaxationSystem | null` + `isVatPayer: boolean | null` (Sprint 7 §SP-3 — nullable). Coupled-rule iff `requiresTaxation(type) ⇔ both-non-null`: `'fop'` / `'tov'` мусять мати обидва не-null; `'individual'` / `'organization'` — обидва null. Refine `TAXATION_FIELDS_MISMATCH_TYPE` у Zod entity (read-side); write-DTO `CreateBusinessSchema` — `z.discriminatedUnion('type', [...])` з 4 variants (taxation-поля присутні фізично лише у `fop` / `tov`); service-layer cross-check на UPDATE через document-resident `type`. Окремий VAT-coupled `isVatPayer === true ⇒ taxationSystem ∈ {simplified-3, general}` активується лише коли обидва поля non-null
- `slug` (case-preserved display) + `slugLower` (lowercase). Unique-index на `slugLower`. Reserved-list — `packages/types/src/constants/reserved-slugs.ts`. Slug-генератор у `slug-generator.service.ts` (8-char A-Za-z0-9, max 10 retries, `crypto.randomBytes`); shared free-fn `generateRandomTail()` reuse-ається у `InvoiceSlugGeneratorService` і `AccountSlugGeneratorService`
- `seoIndexEnabled: boolean` (default false) — toggle публікації у пошуковики
- `ownerId: ObjectId | null` + `managers: ObjectId[]` — null-owner режим бухгалтера; інваріант `ownerId === null ⇒ managers.length ≥ 1` у Zod refine
- `deletedAt` навмисно невикористане (Sprint 3 §C2 = hard-delete; поле залишене на майбутнє)
- **Поле `invoiceSlugPresetDefault` видалене у Sprint 9** — переїхало на `Account` (per-account нумерація інвойсів, §SP-6)
- Indexes: unique `slugLower`, sparse `ownerId`, `managers`

### Account

Файл: `apps/api/src/modules/accounts/schemas/account.schema.ts` | Zod: `packages/types/src/entities/account.ts`

- **Sprint 9 §SP-1** — банківський рахунок під бізнесом. Розщеплення доменної моделі: до Sprint 9 IBAN жив на `Business.requisites`; Account виносить його в окрему сутність, щоб ФОП з 2 рахунками (Privat + Mono) не дублював юр-особу
- `businessId: ObjectId` (required, immutable post-creation), `iban: string` (через `ibanZod`; **immutable post-creation** — §SP-2; `UpdateAccountSchema` навмисно не містить), `name: string` (max 60 chars, NBU-charset; auto-default `"{BANK_LABEL[bankCode]} •{ibanLast4}"` або `"Банк •{last4}"` на null-bankCode)
- `bankCode: BankCode | null` — **stored derived value** (§SP-9). `AccountsService.create` обчислює через `bankCodeFromIban(iban)` рівно один раз і пишеться у документ; runtime НЕ перераховує. IBAN immutability + stored bankCode → drift неможливий. `null` для нерозпізнаних МФО (поза `BANK_MFO_MAP`) — bank-label-row ховається у всіх 4 UI-точках (cabinet AccountsSection card, cabinet BasicSection, public list-card, public per-account heading)
- `slug: string` — case-sensitive 8-char A-Za-z0-9 random tail (§SP-10 — модель invoice-slug, не business-slug). Compound-unique `(businessId, slug)` без `slugLower`-derivative. Generator: `AccountSlugGeneratorService` (10 attempts, потім `ACCOUNT_SLUG_GENERATION_FAILED`); reserved-check НЕ потрібен (account-slug не світиться у URL верхнього рівня)
- `invoiceSlugPresetDefault: SlugPreset | null` (Sprint 9 §SP-6 — переїхало з Business; default `null` = "не визначено", форма створення інвойсу fallback-ить на global system default `'simple'` коли `account.invoiceSlugPresetDefault === null`)
- `deletedAt: Date | null` — навмисно невикористане (mirror Business.deletedAt; §SP-3 — hard-delete всередині `withTransaction`)
- Indexes: compound unique `(businessId, slug)` case-sensitive, **compound unique `(businessId, iban)`** (§SP-2 — anti-duplicate IBAN під одним бізнесом; cross-business duplicate дозволений), `(businessId, createdAt)` direction-neutral для cabinet/public list-sort
- Delete: консервативний — `Invoice.countDocuments({accountId}) > 0` → 409 `ACCOUNT_HAS_INVOICES` усередині `withTransaction` (§SP-3); race-protection через touch-account pattern з `InvoicesService.create`

### Invoice

Файл: `apps/api/src/modules/invoices/schemas/invoice.schema.ts` | Zod: `packages/types/src/entities/invoice.ts`

- **`accountId: ObjectId`** (Sprint 9 §SP-6, required) — invoice nest-иться під Account. `businessId: ObjectId` **залишається** як denormalized field (set on insert з `account.businessId`, immutable після — Account.businessId immutable + Invoice.accountId immutable → Invoice.businessId структурно invariant). Тримаємо для прямого `Invoice.deleteMany({businessId})` у cascade-business-delete і analytical-запитів "сума інвойсів по бізнесу" без `$lookup` через accounts
- `slug` (case-sensitive — Sprint 4 SP-8 asymmetry), `amount: number | null` (копійки; null = signage-mode "клієнт сам вводить"), `amountLocked` (coupled rule SP-6: `amount === null && amountLocked === true` блокується refine), `paymentPurpose: string | null` (null = inherit з `business.paymentPurposeTemplate` через `effectiveInvoicePurpose`), `validUntil: Date | null`, `slugPreset: SlugPreset | null` (analytics-поле — який пресет згенерував)
- `slugCounterScope: string | null` + `slugCounter: number | null` (Sprint 4 §4.1) — paired counter-fields для preset-режимів з лічильником (`'simple'` | `YYYY` | `YYYY-MM`). `null` для explicit/random/with-purpose
- `payeeSnapshot: { recipientName, iban, taxId, paymentPurpose } | null` (Sprint 4 review fix + Sprint 9 §SP-6 — джерела оновлені): `iban` тепер з `account.iban` на момент create, `recipientName`/`taxId` — з `business.name`/`business.taxId`, `paymentPurpose` — effective resolved
- Indexes: **compound unique `(accountId, slug)`** (Sprint 9 — переміщено з `businessId`), compound `(accountId, createdAt -1, _id -1)` для list-pagination, non-unique `(businessId, createdAt -1)` (Sprint 9 — для cascade-business-delete filter-у і analytical-запитів), sparse `validUntil`, **partial-unique compound** `(accountId, slugCounterScope, slugCounter)` з `partialFilterExpression: { slugCounterScope: $type 'string', slugCounter: $type 'int' }` — race-блок counter-collision у per-account namespace

### InvoiceSlugCounter

Файл: `apps/api/src/modules/invoices/schemas/invoice-slug-counter.schema.ts`

- Sprint 4 §4.1 counter-doc collection; namespace переміщено з `businessId` на `accountId` (Sprint 9 §SP-6 — per-account-нумерація)
- Fields: `businessId: ObjectId` (denormalized, для cascade-business-delete filter-у без `$lookup`), `accountId: ObjectId`, `scope: string` (`'simple'` | `YYYY` | `YYYY-MM`), `last: number`
- Indexes: unique `(accountId, scope)`, non-unique `(businessId)` для cascade-business-delete

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

- `AppModule` → `Auth`, `Email`, `Users`, `Payments`, `Reports`, `Storage`, `Ai`, `Qr`, `Businesses`, `Accounts`, `Invoices` + global `ThrottlerGuard` (APP_GUARD), `OnboardingInterceptor` (APP_INTERCEPTOR)
- `AuthModule` ↔ `UsersModule` (`forwardRef`, circular)
- `AuthModule` → `StorageModule` (Google avatar re-upload у `handleGoogleAuth`)
- `EmailModule` — `@Global()`
- `RedisModule` — `@Global()`, exports `REDIS_CLIENT` + `RedisCounterService` (Lua-based atomic counters)
- `PaymentsModule` → `UsersModule`; провайдери: `PAYMENT_PROVIDER` (StripeService) + окремий `CatalogService` зі своїм Stripe SDK instance (no dep on `IPaymentProvider`)
- `AiModule` → `UsersModule`; провайдер `AI_PROVIDER` (AnthropicService); guard `AiRateLimitGuard`
- `StorageModule` → `UsersModule`; провайдер `STORAGE_PROVIDER` (CloudflareR2Service); exports `StorageService` (consumed by `AuthModule`)
- **Sprint 9 one-way DAG** (`Users ← Businesses ← Accounts ← Invoices`):
    - `BusinessesModule` → `MongooseModule.forFeature([Business, Account, Invoice, InvoiceSlugCounter])` + `UsersModule`; providers: `BusinessesService` (cascade-delete розширений на 4 collections), `SlugGeneratorService`, `BusinessAccessGuard`. Counter-aggregation (`getBySlug` accountsCount/invoicesCount) — через direct `@InjectModel(Account.name)` + `@InjectModel(Invoice.name)` у `BusinessesController` (без cyclic DI; Sprint 4 dub-registration патерн усунено). Exports `MongooseModule`, `BusinessesService`, `BusinessAccessGuard`
    - `AccountsModule` → `MongooseModule.forFeature([Account, Business, Invoice, InvoiceSlugCounter])` + `BusinessesModule` (one-way; no `forwardRef`) + `QrModule`; controllers: `AccountsController` (cabinet) + `PublicAccountsController` (public); providers: `AccountsService`, `AccountSlugGeneratorService`, `AccountAccessGuard`. Exports `MongooseModule`, `AccountsService`, `AccountAccessGuard`
    - `InvoicesModule` → `MongooseModule.forFeature([Invoice, Account, InvoiceSlugCounter])` + `BusinessesModule` + `AccountsModule` (one-way; no `forwardRef`) + `QrModule`; controllers: `InvoicesController` (cabinet) + `PublicInvoicesController` (public); providers: `InvoiceSlugGeneratorService`, `InvoicesService`, `InvoiceAccessGuard`. Exports `MongooseModule`, `InvoiceSlugGeneratorService`, `InvoicesService`
- `QrModule` controllers: `QrController` (Sprint 8 — `POST /qr/preview` для anon-лендингу). Exports `QrService` (`buildNbuPayloadLinkForInput`, `renderForUrl`, `renderForNbuPayload`); консумується `PublicBusinessesController`, `PublicAccountsController`, `PublicInvoicesController`
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
- `AccountAccessGuard` (Sprint 9) — читає вже attach-нутий `request.business`, лукапить account за `accountSlug` (case-sensitive `(businessId, slug)`), перевіряє `account.businessId === business._id`, attach до `request.account` для `@CurrentAccount()`
- `InvoiceAccessGuard` (Sprint 9 рефакторинг) — лукап `Invoice.findOne({accountId, slug})` (compound-unique міграція з `businessId` на `accountId`); guard-ланцюжок на `InvoicesController` — `JwtActive` + `BusinessAccess` + `AccountAccess` на класі, `InvoiceAccess` на route-level
- Файли: `apps/api/src/common/guards/`, `apps/api/src/modules/{ai,businesses,accounts,invoices}/`

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

| Метод | Шлях      | Guard | Опис                           |
| ----- | --------- | ----- | ------------------------------ |
| GET   | `/`       | —     | Root                           |
| GET   | `/health` | —     | Health check + timestamp + env |

### AuthController (`apps/api/src/modules/auth/auth.controller.ts`)

| Метод | Шлях                      | Guard                                       | Опис                                       |
| ----- | ------------------------- | ------------------------------------------- | ------------------------------------------ |
| GET   | `/auth/google`            | `AuthGuard('google')` + `@SkipOnboarding()` | Старт Google OAuth                         |
| GET   | `/auth/google/callback`   | `AuthGuard('google')` + `@SkipOnboarding()` | OAuth callback, set refresh cookie         |
| POST  | `/auth/check-email`       | —                                           | Перевірка існування акаунту (rate-limited) |
| POST  | `/auth/login/password`    | —                                           | Вхід з паролем                             |
| POST  | `/auth/magic-link/send`   | —                                           | Відправка magic link                       |
| POST  | `/auth/magic-link/verify` | —                                           | Верифікація magic link                     |
| POST  | `/auth/password/set`      | `JwtActiveGuard` + `@SkipOnboarding()`      | Встановлення першого паролю                |
| POST  | `/auth/password/change`   | `JwtActiveGuard` + `@SkipOnboarding()`      | Зміна паролю, revoke all tokens            |
| POST  | `/auth/password/reset`    | —                                           | Скидання через magic link token            |
| POST  | `/auth/password/verify`   | `JwtActiveGuard` + `@SkipOnboarding()`      | Перевірка для sensitive дій                |
| POST  | `/auth/refresh`           | —                                           | Ротація refresh token                      |
| POST  | `/auth/logout`            | —                                           | Revoke refresh token                       |

### UsersController (`apps/api/src/modules/users/users.controller.ts`)

| Метод | Шлях                                | Guard                                  | Опис                       |
| ----- | ----------------------------------- | -------------------------------------- | -------------------------- |
| GET   | `/users/me`                         | `JwtActiveGuard` + `@SkipOnboarding()` | Профіль + billing snapshot |
| PATCH | `/users/me`                         | `JwtActiveGuard` + `@SkipOnboarding()` | Оновлення профілю          |
| POST  | `/users/me/accept-terms`            | `JwtActiveGuard` + `@SkipOnboarding()` | Прийняття ToS версії       |
| POST  | `/users/me/executions/spend`        | `JwtActiveGuard`                       | Витрата executions         |
| GET   | `/users/me/executions/transactions` | `JwtActiveGuard`                       | Історія транзакцій         |
| POST  | `/users/account/delete`             | `JwtActiveGuard` + `@SkipOnboarding()` | Запит на видалення         |
| POST  | `/users/account/delete/confirm`     | `JwtActiveGuard` + `@SkipOnboarding()` | Підтвердження паролем      |
| POST  | `/users/account/restore`            | `JwtAuthGuard`                         | Відновлення акаунту        |

### PaymentsController (`apps/api/src/modules/payments/payments.controller.ts`)

| Метод | Шлях                          | Guard                                   | Опис                                         |
| ----- | ----------------------------- | --------------------------------------- | -------------------------------------------- |
| GET   | `/payments/catalog`           | `@SkipThrottle()` + `@SkipOnboarding()` | Catalog from Stripe (cached)                 |
| POST  | `/payments/checkout-session`  | `JwtActiveGuard`                        | Створення Stripe checkout                    |
| POST  | `/payments/portal-session`    | `JwtActiveGuard`                        | Створення billing portal URL                 |
| POST  | `/payments/reset`             | `JwtActiveGuard`                        | Скидання billing (видалення Stripe customer) |
| POST  | `/payments/webhook/:provider` | `@SkipThrottle()`                       | Stripe webhook ingestion                     |

### AiController (`apps/api/src/modules/ai/ai.controller.ts`)

| Метод  | Шлях               | Guard                                 | Опис                |
| ------ | ------------------ | ------------------------------------- | ------------------- |
| POST   | `/ai/chat`         | `JwtActiveGuard` + `AiRateLimitGuard` | SSE streaming chat  |
| GET    | `/ai/chat/history` | `JwtActiveGuard`                      | Історія повідомлень |
| DELETE | `/ai/chat/history` | `JwtActiveGuard`                      | Очищення історії    |

### StorageController (`apps/api/src/modules/storage/storage.controller.ts`)

| Метод  | Шлях                         | Guard            | Опис                                                   |
| ------ | ---------------------------- | ---------------- | ------------------------------------------------------ |
| POST   | `/storage/avatar/upload-url` | `JwtActiveGuard` | Presigned PUT URL (Content-Type signed, 5-min TTL)     |
| POST   | `/storage/avatar/commit`     | `JwtActiveGuard` | HeadObject verify + update profile.avatar + delete old |
| DELETE | `/storage/avatar`            | `JwtActiveGuard` | Clear profile.avatar + delete R2 file                  |

### BusinessesController (`apps/api/src/modules/businesses/businesses.controller.ts`)

Cabinet zone — slug як primary route-param; resolved через `slugLower` unique-index.
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| GET | `/businesses/me` | `JwtActiveGuard` | Список бізнесів через single-aggregation pipeline (`$lookup` accounts + invoices); response items містять `accountsCount: number` + `invoicesCount: number` (Sprint 9 §9.1) |
| POST | `/businesses/me` | `JwtActiveGuard` | Створення (4-step wizard, один POST). Body містить top-level `taxId` (Sprint 9 §SP-1 — `requisites`-wrapper видалено). Slug сервер генерує. Response містить canonical slug |
| GET | `/businesses/me/:slug` | `JwtActiveGuard` + `BusinessAccessGuard` | Повний об'єкт + `accountsCount: number` + `invoicesCount: number` (Sprint 9 — direct `@InjectModel` countDocuments, без cyclic DI) |
| PATCH | `/businesses/me/:slug` | `JwtActiveGuard` + `BusinessAccessGuard` | Часткове оновлення; `.strict()` блокує slug/type/ownership; coupled VAT × taxationSystem cross-field check. **Поле `invoiceSlugPresetDefault` видалено** (Sprint 9 — переїхало на Account) |
| DELETE | `/businesses/me/:slug` | `JwtActiveGuard` + `BusinessAccessGuard` | Cascade hard-delete (Sprint 9 §SP-5 розширений): atomic `withTransaction` видаляє business + всі його accounts + invoices + invoice-counter-doc-и. Response: `{ affectedAccounts: number, affectedInvoices: number }`. На non-replica-set Mongo → 500 `CASCADE_DELETE_REQUIRES_REPLICA_SET` |

### PublicBusinessesController (`apps/api/src/modules/businesses/public-businesses.controller.ts`)

Public zone (`pay.finly.com.ua`) — без auth, без cookie. `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`. Throttle bucket `'public-payment'` 600/min/IP.
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| GET | `/businesses/public/:slug` | `@SkipOnboarding()` | **Sprint 9 §SP-4 — root-list-view**: 5 whitelist-полів (`type`, `name`, `slug`, `acceptedBanks`, `seoIndexEnabled`) + `accounts: PublicAccountListItem[]` (`{slug, name, bankCode, ibanMask}`, sort `createdAt asc`). QR-endpoints переїхали на `PublicAccountsController` |

### AccountsController (`apps/api/src/modules/accounts/accounts.controller.ts`)

Cabinet zone — Sprint 9 §9.1. Префікс `/businesses/me/:slug/accounts`. Class-level guards: `JwtActiveGuard` + `BusinessAccessGuard`; route-level `AccountAccessGuard` для read/update/delete.
| Метод | Шлях | Guards | Опис |
|-------|------|--------|------|
| GET | `/businesses/me/:slug/accounts` | `JwtActive` + `BusinessAccess` | Список account-ів бізнесу з per-item `invoicesCount` (single-aggregation pipeline). Response shape `AccountWithCounts[]`, sort `createdAt desc` |
| POST | `/businesses/me/:slug/accounts` | `JwtActive` + `BusinessAccess` | Body: `{ iban, name? }` (`.strict()`). Backend resolve `bankCode` через `bankCodeFromIban(iban)`, ставить як stored field (§SP-9); auto-generate `name` з МФО+last4 якщо не передано; slug-tail random. 11000-mapping: `(businessId, slug)` → 500 `ACCOUNT_SLUG_GENERATION_FAILED`; `(businessId, iban)` → 409 `ACCOUNT_IBAN_DUPLICATE`; інше → 500 `ACCOUNT_CREATE_FAILED` |
| GET | `/businesses/me/:slug/accounts/:accountSlug` | `JwtActive` + `BusinessAccess` + `AccountAccess` | Повний account з `invoicesCount` (real-time `Invoice.countDocuments({accountId})`). Case-sensitive slug lookup |
| PATCH | `/businesses/me/:slug/accounts/:accountSlug` | `JwtActive` + `BusinessAccess` + `AccountAccess` | Partial update — редаговані тільки `name` + `invoiceSlugPresetDefault`. `iban`/`slug`/`businessId`/`bankCode` immutable через `.strict()` |
| DELETE | `/businesses/me/:slug/accounts/:accountSlug` | `JwtActive` + `BusinessAccess` + `AccountAccess` | Hard-delete у `withTransaction` (Sprint 9 §SP-3): preflight `Invoice.countDocuments({accountId}) > 0` → 409 `ACCOUNT_HAS_INVOICES` (без cascade). На 0 → `Account.deleteOne` + `InvoiceSlugCounter.deleteMany({accountId})` атомарно |

### PublicAccountsController (`apps/api/src/modules/accounts/public-accounts.controller.ts`)

Public zone — Sprint 9 §9.1. Префікс `/businesses/public/:slug/account`. Без auth. `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`. Throttle bucket `'public-payment'` 600/min/IP.
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| GET | `/businesses/public/:slug/account/:accountSlug` | `@SkipOnboarding()` | `PublicAccountViewSchema` whitelist: `{slug, name, bankCode, ibanMask, business: {type, name, slug, acceptedBanks, seoIndexEnabled}, nbuLinks: {primary, legacy}}`. `ibanMask` як `"•{last4}"` — server-derived disambiguator (§SP-9 point 4) |
| GET | `/businesses/public/:slug/account/:accountSlug/qr/business.png` | `@SkipOnboarding()` | QR на public URL `{PAY_PUBLIC_URL}/{businessSlug}/{accountSlug}`; знак гривні в центрі |
| GET | `/businesses/public/:slug/account/:accountSlug/qr/nbu.png?host=primary\|legacy` | `@SkipOnboarding()` | QR з NBU-payload-link (формат 003) на одну з двох allowed адрес |

### InvoicesController (`apps/api/src/modules/invoices/invoices.controller.ts`)

Cabinet zone — Sprint 4 §4.2 + Sprint 9 §9.1 рефакторинг. Префікс `/businesses/me/:slug/accounts/:accountSlug/invoices`. Class-level guards: `JwtActiveGuard` + `BusinessAccessGuard` + `AccountAccessGuard`; route-level `InvoiceAccessGuard` для read/update/delete.
| Метод | Шлях | Guards | Опис |
|-------|------|--------|------|
| GET | `.../invoices?page=&limit=` | class chain | Paginated list через `getByAccountId` з `sort: { createdAt: -1, _id: -1 }`. Response: `{ items, total, page, limit }` |
| POST | `.../invoices` | class chain | Create через `CreateInvoiceSchema` discriminated union `slugInput`. Backend генерує slug + tail у per-account namespace; retry-on-11000 (до 3 спроб). Touch-account у власній tx (orphan-prevention vs cascade-delete-account, §SP-3). Response: повний invoice |
| GET | `.../invoices/:invoiceSlug` | class chain + `InvoiceAccess` | Повний invoice (case-sensitive slug lookup, Sprint 4 SP-8) |
| PATCH | `.../invoices/:invoiceSlug` | class chain + `InvoiceAccess` | Partial update; `.strict()` блокує slug/slugPreset/businessId/accountId; coupled `amount × amountLocked` cross-field check |
| DELETE | `.../invoices/:invoiceSlug` | class chain + `InvoiceAccess` | Hard-delete (5s frontend-Undo). Filter через `accountId` (Sprint 9 — раніше `businessId`) |

### PublicInvoicesController (`apps/api/src/modules/invoices/public-invoices.controller.ts`)

Public zone — Sprint 4 §4.3 + Sprint 9 §9.1 URL-ремайнінг. Префікс `/businesses/public/:slug/account/:accountSlug/invoices`. Без auth, з `Cache-Control: no-store` (invoice — non-cacheable через amount + validUntil).
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| GET | `.../invoices/:invoiceSlug` | `@SkipOnboarding()` | 8 whitelist-полів (invoice fields + nested business view + **`account: {slug, name, bankCode, ibanMask}`** + `nbuLinks`); `paymentPurpose` resolved через `effectiveInvoicePurpose` (always-string у view, не nullable); `payload-mapper` приймає `(business, account, invoice)` triple |
| GET | `.../invoices/:invoiceSlug/qr/business.png` | `@SkipOnboarding()` | QR на канонічну public-URL інвойсу `{PAY_PUBLIC_URL}/{businessSlug}/{accountSlug}/{invoiceSlug}` |
| GET | `.../invoices/:invoiceSlug/qr/nbu.png?host=primary\|legacy` | `@SkipOnboarding()` | QR з NBU-payload-link (формат 003) — payload містить amount + lockMask + validUntil |

### QrController (`apps/api/src/modules/qr/qr.controller.ts`)

Sprint 8 §8.1 — публічний preview-ендпоінт для anon-лендингу. Без auth, без cookie, без БД. Throttle-bucket `'qr-preview'` (10/min/IP) — окремий від `'public-payment'` (600/min) і `'default'` (60/min) бо payload-перебір на anon-endpoint потенційно дешевший за full payment-page-hit.
| Метод | Шлях | Guard | Опис |
|-------|------|-------|------|
| POST | `/qr/preview` | `@SkipThrottle({ default: true })` + `@Throttle({ 'qr-preview': 10/min })` + `@SkipOnboarding()` | Input `QrPreviewInputSchema` (receiverName/iban/taxId/purpose; жорстко `'individual'`); reuse `QrService.renderForNbuPayload` 1:1; Response `{ data: { link, qrPngBase64 } }` (формат 003, host = `NBU_HOST_PRIMARY`) |

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
- **Public endpoint whitelist — leak-vector тільки через NBU-payload-link** (Sprint 3 + Sprint 9 переадресація на account-level): `GET /businesses/public/:slug` JSON містить лише `{type, name, slug, acceptedBanks, seoIndexEnabled, accounts: PublicAccountListItem[]}` — реквізити IBAN/taxId **не leak-аються JSON-ом**. `nbuLinks` переїхали на per-account-controller (`GET /businesses/public/:slug/account/:accountSlug` → `{slug, name, bankCode, ibanMask, business, nbuLinks}`). `ibanMask` = `"•{last4}"` server-derived rendering — НЕ leak реального IBAN, 5-символьна публічна disambiguation-маска. Whitelist інваріант: дані доступні **тільки через формати, що читаються банком як платіжна команда** (Base64URL у NBU-link, або QR PNG). `PublicBusinessSchema.parse()` + `PublicAccountViewSchema.parse()` + `PublicInvoiceSchema.parse()` strip-ають leak-fields на serialization step.
- **host-aware routing на одному Next.js project** (Sprint 3 + Sprint 9 §SP-4/§SP-5 матрьошкова навігація): cabinet (`finly.com.ua`) і public (`pay.finly.com.ua`) ділять один контейнер. Middleware має 5 branches: **A1** (public+root `/{businessSlug}` → rewrite на `/host-pay/{businessSlug}` + `Cache-Control: no-store` defense-in-depth для CDN/proxy-шару проти 1→2-Account redirect-flip — §SP-4); **A2 — семантичний flip vs Sprint 4** (public+2-сегментний `/{biz}/{acc}` — раніше invoice-URL, зараз account-URL → rewrite на `/host-pay/{biz}/{acc}`); **A3** (public+3-сегментний `/{biz}/{acc}/{inv}` → rewrite на `/host-pay/{biz}/{acc}/{inv}`); **B** (public+non-root, non-2/3-segment → 404); **C** (cabinet+`/host-pay/` → 404, direct-URL-attack захист). Host comparison **case-insensitive** за RFC 7230 §2.7. Reserved-slug check **тільки на business-slug** у A1/A2/A3 (account/invoice slugs — system-generated). Cookie isolation: `bid_refresh` без `Domain=` → invisible на pay-host. Server Components `host-pay/[slug]/page.tsx`, `host-pay/[slug]/[accountSlug]/page.tsx`, `host-pay/[slug]/[accountSlug]/[invoiceSlug]/page.tsx` роблять defense-in-depth host check через `headers()`.

- **Invoice slug-case asymmetry vs business-slug** (Sprint 4 §SP-8 + Sprint 9 §SP-6 namespace-shift): business-slug case-insensitive (vanity-target, Twitter-style); invoice-slug **case-sensitive** (99% system-generated; case-insensitive lookup нульовий UX-value). Compound-unique scope перевели зі Sprint 9 `(businessId, slug)` → `(accountId, slug)` — два account-и одного business дозволено мати інвойс з однаковим slug-string-ом (Privat-`inv-001` / Mono-`inv-001` через per-account counter-namespace). Server Component на public-page робить canonical-redirect 308 тільки для business-slug; account- і invoice-slug exact-match-or-404.

- **Slug-preset counter monotonic per (account, scope)** (Sprint 4 §4.1 + Sprint 9 §SP-6 namespace-shift): окрема `InvoiceSlugCounter`-колекція (Sprint 4 review fix після виявлення дефекту "counter reuse after delete"), unique-index переїхав з `(businessId, scope)` на `(accountId, scope)`. Fast-path `findOneAndUpdate({...}, {$inc: { last: 1 }})` без upsert; lazy-bootstrap `create({ last: legacyMax+1 })` на first-touch (greenfield → `last=1`; existing data → MAX over invoices у scope-і + 1). Session-binding: counter-allocation викликається з-середини invoice-create-transaction-у з тією ж `ClientSession` — TX abort rollback-ить counter разом з invoice. **Partial-unique compound** `(accountId, slugCounterScope, slugCounter)` як defense-in-depth — race-блокує counter-collision на write-path: два concurrent transactions з тим самим preset-counter → один проходить, другий падає на 11000 → `InvoicesService.create` retry-ить з fresh session. `slugCounterScope`: `'simple'` | `YYYY` | `'YYYY-MM'`. Counter-presets записують paired `(scope, counter)`; non-counter (explicit/random/with-purpose) — обидва null, виключені з partial-index через `partialFilterExpression`. Privat-account і Mono-account одного business мають незалежні counter-послідовності.

- **Lock-mask FEFF/FFFF derived from `amountLocked`** (Sprint 4 §4.3 + SP-6 + Sprint 9 mapper-signature): backend-only mapping у `payload-mapper.ts` (`buildPayloadInputFromInvoice(business, account, invoice)` — Sprint 9 додав `account` параметр для `iban`-source-у). `amountLocked=true → FFFF` (все locked), `amountLocked=false → FEFF` (поле 8 "Сума" editable). Frontend оперує boolean `amountLocked` — не знає про hex-mask. Інверсна UI-семантика switch-а "Дозволити правити суму" (ON ⇔ `amountLocked=false`) живе тільки у формах (`CreateInvoiceForm`, `AmountSection`).

- **`validUntil` у Kyiv-tz, не UTC** (Sprint 4 §4.1 boundary fix): `formatYymmddhhmmss` + `getKyivYearMonth` через `Intl.DateTimeFormat({ timeZone: 'Europe/Kyiv' })` + `formatToParts`. Контракт NBU input явно інтерпретує payload-час як локальний український. UTC-варіант ламав би: 1 червня 00:30 Київ (= UTC 31 травня 21:30Z) отримував би immutable slug `2026-05-...` замість `2026-06-...` (з `with-month`-пресета); `validUntil` у payload відображав би на 2-3 години раніше. Залежність від ICU tzdata — `Europe/Kyiv` available у Node 20+ full-icu за замовчуванням; small-icu fallback не реалізовано (fail-fast invariant).

- **Cascade hard-delete atomic-or-nothing** (Sprint 4 §SP-5 + Sprint 9 §SP-5 розширення): `BusinessesService.delete` cascade видаляє business + всі його `Account` + `Invoice` + `InvoiceSlugCounter` через `connection.startSession() → session.withTransaction()`. Filter `{businessId}` працює прямо на всіх 4 collections — Sprint 9 зберіг `businessId` як denormalized field на Invoice + InvoiceSlugCounter саме для прямого cascade-filter-у без `$lookup` через accounts. Response shape `{ affectedAccounts: number, affectedInvoices: number }`. Mongo вимагає replica-set для transactions; standalone mongod кидає "Transaction numbers are only allowed on a replica set member or mongos" → service ловить, мапить на `CASCADE_DELETE_REQUIRES_REPLICA_SET` 500. Жодного fallback на 2 sequential deletes — orphan-state свідомо неможливий. Production Atlas — replica-set за замовчуванням; dev — три варіанти (Atlas / Docker `--replSet rs0` / local mongod) у root `README.md`. Test-suite: `MongoMemoryReplSet` для cascade-tests і businesses/accounts/invoices-e2e (transactional-aware); `MongoMemoryServer` standalone для решти.

- **Mongo `_id → id` JSON transform** (Sprint 4 §4.4 fix + Sprint 9): глобальний helper `applyJsonTransform(schema)` у `apps/api/src/common/mongoose/json-transform.ts` додає `toJSON`/`toObject`-transform: `_id: ObjectId → id: string` через `.toString()`, strip `__v`. Застосовано на `BusinessSchema` + `AccountSchema` + `InvoiceSchema` + `InvoiceSlugCounterSchema`. Без цього frontend `id`-field (Zod-entity-shape) була б undefined, що ламало `key={item.id}` і dedup-логіки. Aggregation pipelines (`getOwnedAndManagedWithCounts`, account-list-with-counts) не проходять через Mongoose-transform — `_id → id`-mapping робиться явно у `$addFields + $unset`-stage.

- **Public invoice payload — `paymentPurpose` always-resolved** (Sprint 4 §4.7): backend `PublicInvoicesController.getPublic` викликає `effectiveInvoicePurpose(invoice.paymentPurpose, business.paymentPurposeTemplate)` перед serialization → `PublicInvoiceSchema.paymentPurpose: string` (NOT nullable). Inheritance-rule `null → business template` — impl-detail backend; client отримує ефективний рядок, що співпадає з NBU payload-purpose. Single source of truth: UI sub-info і банківська команда показують однаковий текст.

- **`Business.type` immutable post-creation** (Sprint 7 §SP-8): фіксується при `POST /businesses/me`, далі НЕ змінюється. `UpdateBusinessSchema` навмисно не містить `type`-поля; `.strict()` reject-ить будь-яку спробу через DTO-pipe. Зміна `type` тягне 4 каскадні revalidation-и (taxId-формат 10 vs 8, taxation-presence, isVatPayer-presence, paymentPurposeTemplate-семантика); жоден з них не безпечний без user-input-у — тобто "правка через PATCH" неможлива. Якщо ФОП юридично став ТОВ — це новий бізнес у wizard-і, старий лишається архівом або hard-delete-ається. Інвойсний `payee.taxId`-snapshot (Sprint 4) гарантує, що історичні рахунки не торкаються type-mutation-у бізнесу.

- **Public heading type-нейтральний** (Sprint 7 §SP-5): `'Платіж на користь {name}'` для всіх 4 типів. До Sprint 7 був `'Оплата на ${BUSINESS_TYPE_LABEL[type]} ${name}'`; розширення enum-у з 1 до 4 типів дало лінгвістично незграбні комбінації ("Оплата на фізособа Іваненко"), а назва бізнесу зазвичай вже містить юр-форму (дублювання). `BUSINESS_TYPE_LABEL` живе тільки у cabinet read-mode (`BasicSection`) і SEO `<title>`-метатегу; h1 на public-сторінці його НЕ використовує. `PublicBusinessSchema.type` зберігається у contract на майбутнє (aria-label, SEO).

- **ЄДРПОУ без checksum на MVP** (Sprint 7 §SP-2): `legalEntityTaxIdZod` валідує лише `^\d{8}$`; ДКСУ-checksum НЕ перевіряємо. Причини: (1) 2-фазний алгоритм має edge-cases (legacy-коди до 1992, нерезидентські, філії); naive-impl false-negative-ить ~5-10% валідних реальних ЄДРПОУ — для MVP, що відкривається на нові сегменти, заблокований ОСББ зі старим легітимним кодом гірший провал, ніж пропущений typo. (2) ЄДРПОУ — публічний реєстр (opendatabot 5 секунд), РНОКПП ж особистий код з ручним введенням, тому checksum для нього критичний, а для ЄДРПОУ — opt-in. (3) Реальний контроль робить банк-додаток клієнта при списанні (Finly = "тупий генератор", Модель А — `qr-decisions.md` §1.12). Tech-backlog ticket "ЄДРПОУ-checksum (ДКСУ)" — low-priority.

- **TaxationSection conditional unmount type-driven** (Sprint 7 §SP-7): `hasTaxationFields(business)` — composite type-guard: primary `requiresTaxation(b.type)` (truth у `BUSINESS_TYPES`-tuple) + secondary non-null обох taxation-полів (TS-narrow до `TaxationCapableBusiness`). Page-render `business/[slug]/page.tsx` рендерить секцію виключно через цей guard; для `individual` / `organization` секція **не входить у DOM** (а не disabled / прихована через CSS) — UX-rationale: не показуємо порожнє поле для типу, де поле не існує. Drift-protection: legacy-документ ФОП без taxation-полів (gap у міграції) → guard false → uncrash runtime; symmetric для drift'd individual з non-null taxation.

- **Frontend type-aware taxId UI shared helper** (Sprint 7 §SP-4): `apps/web/src/entities/business/taxIdField.ts` — `taxIdFieldConfig(type): { label, placeholder, validator, maxLength }`. **Single source of truth** для wizard `Step2Requisites` і cabinet edit `RequisitesSection`. Static-частина (label/placeholder/validator) — `Record<BusinessType, ...>`; `maxLength` обчислюється factory через `taxIdLengthFor()` з `@finly/types`, не дублюється другим Record-ом. Discriminator-exhaustiveness — додавання нового `BusinessType` без оновлення мапінгу дає compile-error.

- **`BusinessWizardStore` named-steps + dynamic step-list** (Sprint 7 §SP-6): `BusinessWizardStep = 'type-name' \| 'requisites' \| 'taxation' \| 'purpose-banks'` (раніше numeric `1\|2\|3\|4`). `computeStepsForType(type)` — pure function: `fop` / `tov` → 4 кроки, `individual` / `organization` → 3 кроки (skip `'taxation'`). Stable readonly-tuple references для `useMemo`-стабільності. `setType(type)` атомарно reset-ить taxation-fields у undefined при переході fop/tov → individual/organization (запобігає stale taxation-data у submit). Persist `version: 2` + `migrate(numeric → named)` + `partialize` (зберігає тільки `currentStep` + `formData`, actions з create()-callback).

- **`CreateBusinessSchema` discriminated union → param-level pipe** (Sprint 7 §SP-3): `CreateBusinessSchema = z.discriminatedUnion('type', [individualVariant, fopVariant, tovVariant, organizationVariant])` з per-variant `.strict()`. `nestjs-zod` `createZodDto` НЕ підтримує discriminated-union output (TS2509: union-output не extends-able як class), тому `BusinessesController.create` використовує `@Body(new ZodValidationPipe(CreateBusinessSchema))` як param-level pipe — стандартний flow `nestjs-zod` без DTO-class wrapper-а. Глобальний pipe (main.ts) пропускає payload (немає `isZodDto`-marker), param-pipe виконує валідацію. Це **єдиний такий callsite у API** — якщо з'явиться другий, варто винести у helper.

- **NBU `PayloadInputSchema.receiverTaxId` приймає union** (Sprint 7 §SP-10): `payerTaxIdZod = z.union([individualTaxIdZod, legalEntityTaxIdZod])` — рівно 2 нормативних формати (10-цифровий РНОКПП ∪ 8-цифровий ЄДРПОУ). Builder-и 002 / 003 кладуть `input.receiverTaxId` у field 9 без додаткової перевірки довжини — type-binding до конкретного `BusinessType` живе на write-DTO рівні + service-layer; QR-builder робить лише структурну перевірку. Round-trip jsqr-тест (`qr.service.integration.spec`) для 8-digit ЄДРПОУ закриває нормативний Risk #1 sprint-плану.

- **NBU charset refine на entity-Zod** (Sprint 8 fix): `businessNameSchema`, `businessPaymentPurposeTemplateSchema`, `invoicePaymentPurposeSchema` у `@finly/types/entities/*` мають `.refine(isWithinNbuCharset, { message: 'INVALID_NAME_CHARSET' \| 'INVALID_PURPOSE_CHARSET' })` ПОВЕРХ char/byte-limits. До Sprint 8 NBU-charset-валідатор жив internal-only у `qr/_payload-internals.assertNbuCharset` і викликався лише builder-ом — невалідний-для-NBU символ (emoji ☕, multi-line LF/CR, Unicode-блок без Win1251-mapping) проходив save → render QR падав з 500 на public-сторінці (`PayloadValidationError → AllExceptionsFilter` мапив як `INTERNAL_ERROR`, бо це не `HttpException`). Public API expose-нутий через `qr/charset.ts` (`isWithinNbuCharset`, `findInvalidNbuCharIndex`). Закриває Sprint 2 §2.2 інваріант "будь-який валідно збережений Business / Invoice → валідний QR" для всіх consumer-ів (cabinet wizard, cabinet edit, anon Sprint 8 preview).

- **`PayloadValidationError` → 400 у `AllExceptionsFilter`** (Sprint 8 fix): окремий `instanceof PayloadValidationError`-check у `catch()` мапить за `PayloadErrorCode`-family. Overall-size overflow (`PAYLOAD_OVERALL_SIZE_EXCEEDED`, `PAYLOAD_BASE64URL_SIZE_EXCEEDED`) → 400 + `RESPONSE_CODE.PAYLOAD_TOO_LARGE` (user-actionable: "скоротіть назву / призначення"). Field-format errors → 400 + `VALIDATION_ERROR` (defense-in-depth, Zod на write-DTO мав би їх зловити раніше). Host-config errors → 500 + `INTERNAL_ERROR` (server-misconfig). До Sprint 8 цей шлях віддавав 500 на легітимний user-input — наприклад, `purpose='А'.repeat(420)` cyrillic (валідні 420 chars per-field, але payload 840 B перевищує норматив 507 B, emergent property, не окремого поля).

- **Sprint 8 anon QR-preview endpoint `POST /qr/preview`**: без auth, без cookie, без БД. Throttle-bucket `'qr-preview'` (10/min/IP) — окремий від `'public-payment'` (600/min) і `'default'` (60/min) у `app.module.ts`. Payload-перебір на anon-endpoint потенційно дешевший за full payment-page-hit (нема DB lookup-у бізнесу), тому restrictive за дизайном. Reuse `QrService.renderForNbuPayload` 1:1; format 003, host = `NBU_HOST_PRIMARY`. Контракт `QrPreviewInputSchema` жорстко прибитий до `'individual'` (без UI-перемикача типу — sprint plan §НЕ-скоуп); `.strict()` reject-ить будь-які додаткові ключі.

- **`publicPostJson` symmetric до `publicFetchJson`** (Sprint 8 §8.3): native `fetch` з `credentials: 'omit'` + `Content-Type: application/json` + `JSON.stringify(body)`. Anon-flow живе під контрактом "без auth, без cookie" — axios `apiClient` з `withCredentials: true` + Bearer-interceptor суперечив би: якщо anon-користувач залогінений у іншій вкладці на cabinet host, його `bid_refresh`-cookie + `Bearer`-токен можуть просочитися у anon-запит. Native `fetch({ credentials: 'omit' })` гарантовано вирізає те і інше. Non-2xx → `PublicApiError` (reuse того самого error-class з `publicFetchJson`); body НЕ парситься на non-2xx, тому frontend error-mapping робить status-based guess (на `mode:onChange + disabled={!isValid}` 400 практично завжди = backend overall-size overflow).

- **`useHasHydrated` через `useSyncExternalStore`** (Sprint 8 §8.3): Zustand `persist` гідратує асинхронно після першого render. Якщо компонент читає store-snapshot на mount (через `getState()`) і кешує у RHF `defaultValues` — snapshot frozen на момент init → перший render бачить порожні values, hydration не propagates. Sprint 8 UAT LAND-3 ("reload → форма відновлена з localStorage без миготіння") вимагає gate перед render-ом форми. Канонічний React `useSyncExternalStore` (а не `useState + useEffect`) дає (1) SSR-safe by design (`getServerSnapshot = false` детерміністично без читання `store.persist`, який undefined у Next.js prerender bundle), (2) React-pure без `react-hooks/set-state-in-effect`-warning (React 19.1+).

- **Claim-flow intent state-machine + sibling-hook у protected layout** (Sprint 8 §8.4): `qrLandingDraftStore` має `intent: 'idle' \| 'claim-pending' \| 'claimed' \| 'claim-failed'`. Anon click "Зберегти у кабінет" → `setIntent('claim-pending')` + `router.push('/auth/signin')`. Після auth `useClaimLandingDraft` (у `(protected)/layout.tsx` як **sibling до AuthGuard**, не дитина) детектить `intent === 'claim-pending'` → call `POST /businesses/me` → `clearAll` + redirect. Race-protection через `inProgressRef` (без нього `formData` у deps re-fires effect → дублікат бізнесу). Гілка B (incomplete profile після magic-link signup): AuthGuard редіректить на `/profile?mode=new`, hook **залишається змонтований** (sibling, не дитина), чекає на `onboardingComplete` → fires автоматично після PATCH `/users/me`. Failure НЕ очищає formData — користувач не втрачає введене; intent='claim-failed' для post-failure recovery UX (Sprint 8.5+).

- **Sprint 8 form-lift у `QrLandingBlock`**: `useForm`-instance створюється у Block (після hydration-gate) і передається prop у `QrLandingForm` + `QrLandingResult`. Без lift-у "Очистити" у Result не міг би reset-нути `<input>`-и у Form (RHF uncontrolled, `defaultValues` frozen на mount), а hydration не міг би заповнити форму persisted-snapshot-ом. Цей pattern єдиний такий callsite у Sprint 8 — інші форми у проекті прості без cross-component-state-sharing.

- **`Account.iban` immutable post-creation** (Sprint 9 §SP-2): фіксується при `POST /businesses/me/:slug/accounts`, далі ніколи не змінюється. `UpdateAccountSchema` навмисно не містить `iban`-поля; `.strict()` reject-ить будь-яку спробу. ФОП помилився — видаляє account (якщо 0 інвойсів) і створює новий. Той самий патерн immutability як `Business.type` (Sprint 7 §SP-8). **Anti-duplicate IBAN per business** через compound-unique `(businessId, iban)` index — два рахунки з однаковим IBAN під одним бізнесом заборонені на DB-рівні (typo на manual-input або re-submit account-форми не створюють два документи з ідентичним `•{last4}`). Mongo 11000 → `AccountsService.create` мапить на 409 `ACCOUNT_IBAN_DUPLICATE`. Cross-business duplicate (ФОП і його ТОВ ділять рахунок) — **дозволено**.

- **`Account.bankCode` stored derived value, не runtime-computed** (Sprint 9 §SP-9): `AccountsService.create` обчислює `bankCodeFromIban(iban)` рівно один раз і пишеться у Account-документ як persistent поле. Read-path серіалізує як є. **Чому stored, а не runtime**: (1) IBAN immutable + stored bankCode → drift неможливий; (2) Read-path public-controller-ів спрощений — без runtime-парсингу IBAN на кожен read; (3) `BANK_MFO_MAP` як snapshot — якщо банк змінив МФО, історичні Account-документи відображають "що було коли клієнт створив рахунок"; (4) Захист від IBAN-leak — read-path не тримає IBAN у dto-shape лише для `bankCodeFromIban` step-у. **Null-bankCode UI-rule** (single source of truth для 4 UI-точок): на `bankCode === null` (нерозпізнаний МФО) bank-label-row **ховається повністю**, НЕ fallback-ить на "Невідомий банк". 4 точки: cabinet `AccountsSection` card + cabinet `BasicSection` per-account-page + public list-card + public per-account heading. На heading `•{last4}`-postfix unconditional (server-derived disambiguator з IBAN-документа незалежно від name-state-у).

- **Account-slug case-sensitive як invoice-slug** (Sprint 9 §SP-10): модель invoice-slug — case-sensitive lookup, compound-unique `(businessId, slug)` БЕЗ `slugLower`-поля. Account-slug system-generated 8-char random `A-Za-z0-9`. Чому invoice-модель, а не business-модель: (1) Business-slug — vanity-target Twitter-style з displayName-derive, user сприймає як власне ім'я; account-slug — random tail, ніколи не вводиться вручну. (2) Vanity-value нульовий — Sprint 6 закладе vanity-slug для business, але НЕ для account. (3) Простіша Mongoose-схема без `slugLower`-prop і pre-save-hook-у. Trade-off: теоретичний edge `abc12345` vs `Abc12345` — 218 трлн комбінацій space, на практиці клієнт копіює URL one-click. **Frontend store-key invariant cascade**: pending-delete Zustand-store-и тримають композитний key = uniqueness-scope БД. Account-store ⇒ `${businessSlug}/${accountSlug}`; invoice-store ⇒ `${businessSlug}/${accountSlug}/${invoiceSlug}` (rekey зі Sprint 4 2-сегментного, бо invoice-uniqueness переїхала з `(businessId, slug)` на `(accountId, slug)` — два account-и одного business дозволено мати інвойс з однаковим slug-string-ом через per-account counter-namespace §SP-6).

- **`Invoice.businessId` denormalized для прямого cascade + аналітики** (Sprint 9 §SP-6): після перенесення invoice-uniqueness з `businessId` на `accountId`, `businessId` залишається на схемі як denormalized field. Set on insert з `account.businessId`, immutable після (Invoice.accountId immutable + Account.businessId immutable → Invoice.businessId структурно invariant). **Чому**: (1) `BusinessesService.delete` cascade робить `Invoice.deleteMany({businessId})` прямим filter-ом без `$lookup` через accounts; той самий патерн на `InvoiceSlugCounter.deleteMany({businessId})`. (2) Cabinet analytical-запити "сума інвойсів по бізнесу" / `BusinessesController.getBySlug` invoicesCount — direct `countDocuments({businessId})` через index `(businessId, createdAt -1)` без `$lookup`. Trade-off: storage-overhead 12 байт per Invoice, але cascade- і analytical-flow коштують zero JOIN.

- **Account hard-delete консервативний — `Invoice.countDocuments({accountId}) > 0` preflight** (Sprint 9 §SP-3): на відміну від Business cascade-delete (Sprint 4 §SP-5 — атомарно видаляє все), `AccountsService.delete` НЕ робить cascade на Invoice. > 0 інвойсів → 409 `ACCOUNT_HAS_INVOICES` з UA-message `"Цей рахунок має {invoicesPhrase}. Спочатку видаліть їх або весь бізнес"`. **Атомарність як race-protection (НЕ aesthetics)**: `withTransaction` навколо countDocuments + `Account.deleteOne` + `InvoiceSlugCounter.deleteMany({accountId})` серіалізується з паралельним `InvoicesService.create` (touch-account pattern, симетрично Sprint 4 review fix touch-business pattern), що пише `Account.updateOne({_id}, {$currentDate: {updatedAt: true}}, {session})` у власній tx. Без `withTransaction` race "count=0 → конкурентний create-invoice → deleteOne" створив би orphan-Invoice з `accountId` на видалений Account. **Two-line-of-defense pre-check** (frontend + backend узгоджені через єдиний `mapApiCode`-source): frontend DangerSection account-page + per-card AccountsSection читають `invoicesCount` з вже-fetched `AccountWithCounts` і викликають `toast.error` БЕЗ network-call-у на > 0 (UX-shortcut); backend `AccountsService.delete` повторює countDocuments всередині того самого `withTransaction` (race-protection). UA-message-template `{invoicesPhrase}`-placeholder pre-resolves через `pluralizeUa(count, 'виставлений інвойс', 'виставлені інвойси', 'виставлених інвойсів')` (helper у `apps/web/src/shared/lib/intl.ts` + симетричний у `apps/api/src/common`).

- **Public matрьошкова URL + 307 redirect-at-1-Account** (Sprint 9 §SP-4): root `pay.finly.com.ua/{businessSlug}` має 3 branch-и за `accounts.length`: 0 → empty-state ("Власник ще не налаштував рахунки"); 1 → **307 Temporary Redirect** на `/{businessSlug}/{accountSlug}` через Next.js `redirect()` у Server Component (НЕ `permanentRedirect`/308); 2+ → list-view карток. **Чому 307, а не 308**: redirect-семантика умовно завязана на стан "у бізнесу рівно 1 Account", який може змінитися (ФОП додасть 2-й). 308 за специфікацією HTTP — постійний; Chrome агресивно кешує його in-memory на всю сесію навіть з `Cache-Control: no-cache`. Користувач, що вперше відкрив root коли був 1 Account, після додавання 2-го застряг би на per-account-вивісці. 307 такої агресивної in-memory-фіксації не має. `Cache-Control: no-store` як defense-in-depth для CDN/proxy-шару — **технічна реалізація у middleware Branch A1**, не у Server Component (Next.js `redirect()` усередині Server Component кидає `NEXT_REDIRECT` без прямого контролю над response-headers).

- **`InvoiceSlugCounter` cascade-flow на 2 рівнях** (Sprint 9 §SP-6): counter-doc namespace переїхав з `businessId` на `accountId` (unique `(accountId, scope)`). Cascade-видалення з 2 точок: (1) `AccountsService.delete` чистить `InvoiceSlugCounter.deleteMany({accountId})` у власній tx — точкова per-account очистка; (2) `BusinessesService.delete` чистить `InvoiceSlugCounter.deleteMany({businessId})` через denormalized `businessId`-field у counter-doc-і — масова per-business cascade без `$lookup` через accounts. Без denormalized `businessId` на counter-doc-у cascade-business мусив би робити `$lookup` accounts → отримати `accountIds[]` → `deleteMany({accountId: {$in}})` (extra round-trip і складніший aggregation). Тести: `MongoMemoryReplSet` для both cascade-flow з assertion-ом 0 documents у всіх 3 collections (Account + Invoice + InvoiceSlugCounter).
