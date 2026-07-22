# Finly

> SaaS для українських ФОП і бухгалтерів: кабінет створює публічні платіжні сторінки, NBU QR/link payloads, рахунки й брендовані QR-матеріали.

## Tech Stack

| Layer           | Technology                                               | Version / Role                                                           |
| --------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Core            | TypeScript, Node.js, pnpm, Turborepo                     | TS 5.9, Node 20, pnpm 10 workspaces                                      |
| Web             | Next.js, React, Zustand, Tailwind CSS, next-themes       | Next 16 App Router, React 19, FSD, single-locale UA                      |
| API             | NestJS, Passport, nestjs-zod, @nestjs/throttler/schedule | Nest 11, JWT + Google OAuth, global ZodValidationPipe                    |
| Data            | MongoDB, Mongoose, Redis, ioredis                        | Mongoose 8 documents, Mongo transactions, Redis locks/rate/session state |
| Product Engines | @finly/types, qrcode, sharp, opentype.js                 | Zod contracts, NBU payload 002/003, branded PNG QR rendering             |
| Integrations    | WayForPay, Resend, Anthropic, Cloudflare R2              | billing, email, public help chat, media storage                          |
| Testing         | Jest, Supertest, MongoMemoryServer, jsdom                | API unit/e2e, web unit/component, shared contract tests                  |

## Architecture Overview

Finly — модульний monorepo-monolith із трьома основними частинами: `apps/api`, `apps/web`, `packages/types`. API є system of record для auth/session lifecycle, users/billing, businesses/accounts/invoices, slug history/reservations, QR rendering, storage, public help AI, email і cleanup cron jobs. Web — тонкий Next App Router shell із FSD layers, client auth bootstrap, global overlay registry і host-aware public payment routing через `apps/web/src/proxy.ts`. `packages/types` є спільним contract layer для Zod entities, DTO contracts, enums, validation, help content і NBU QR payload generation. Реалізовано public payment pages, accounts, invoices, WayForPay billing і custom QR branding; `ReportsModule` лишається scaffold-only.

## Project Structure

```text
apps/
├── api/src/
│   ├── main.ts, app.module.ts
│   ├── config/          # fail-fast env
│   ├── common/          # guards, filters, billing
│   └── modules/         # auth, users, businesses, accounts, invoices, payments
├── api/scripts/         # migrations, asset generation
├── web/src/
│   ├── app/             # root, auth, protected, host-pay
│   ├── entities/        # domain slices
│   ├── features/        # user workflows
│   ├── widgets/         # composed UI blocks
│   └── shared/          # api, config, ui, lib
packages/
└── types/src/           # constants, contracts, entities, qr
docs/
├── conventions/         # mandatory rules
└── product/             # working drafts
```

## Domain Model

### User

Файл: `apps/api/src/modules/users/schemas/user.schema.ts` | Zod: `packages/types/src/entities/user.ts`

- `profile`, `executions`, `billing`, reminder stamps, terms і pending redirect target живуть як embedded fields; `worksAsBookkeeper` — account capability, не role.
- Soft-delete використовує `deletedAt`; restore flow працює через `JwtAuthGuard`, більшість authenticated endpoints — через `JwtActiveGuard`.
- WayForPay billing state зберігає `orderReference`, `recToken`, plan/one-off access, scheduled changes і `reconcileRequiredAt`; `recToken` ніколи не серіалізується у web.

### ExecutionTransaction

Файл: `apps/api/src/modules/users/schemas/execution-transaction.schema.ts` | Contract: `packages/types/src/contracts/executions.ts`

- Append-only credit/debit ledger із `balanceAfter`; зараз використовується billing/user service credit paths, але не має controller endpoint.
- History reads покриті індексом `userId + createdAt`; reservation machinery старого cabinet AI chat уже відсутня.

### Business

Файл: `apps/api/src/modules/businesses/schemas/business.schema.ts` | Zod: `packages/types/src/entities/business.ts`

- Legal payment recipient: `type`, ownership/managers, case-preserved `slug`, `slugLower`, tax fields, default payment purpose, SEO flag, access block і brand slots.
- `ownerId === null` валідний лише з manager-ом; taxation/VAT/taxId coupling живе у shared Zod і service checks.
- `brand.active` рендериться публічно; `brand.pending` зберігає unpaid або demoted logo intent для checkout/re-subscribe flows.

### BusinessSlugHistory / AccountSlugHistory / InvoiceSlugHistory

Файли: `apps/api/src/modules/businesses/schemas/business-slug-history.schema.ts`, `apps/api/src/modules/accounts/schemas/account-slug-history.schema.ts`, `apps/api/src/modules/invoices/schemas/invoice-slug-history.schema.ts`

- Зберігають старі `slugLower` для 90-day redirect grace і anti-squatting; redirect target завжди поточний canonical document.
- `redirect: false` означає reserved hold без public redirect після access lapse reset.
- Cascade delete одразу прибирає history rows для видалених сутностей.

### Account

Файл: `apps/api/src/modules/accounts/schemas/account.schema.ts` | Zod: `packages/types/src/entities/account.ts`

- Bank account під business; IBAN винесено з Business і він immutable після create.
- Unique `(businessId, slugLower)` і `(businessId, iban)`; stored `bankCode` derived once from IBAN і може бути `null`.
- `invoiceSlugPresetDefault` per-account; `deletedAt` існує для forward compatibility, поточні delete flows — hard cascade deletes.

### Invoice

Файл: `apps/api/src/modules/invoices/schemas/invoice.schema.ts` | Zod: `packages/types/src/entities/invoice.ts`

- One-off payment command під account, із denormalized `businessId`, editable vanity `slug`, amount у копійках, optional expiry і purpose override.
- `payeeSnapshot` freezes recipient name, IBAN, tax ID і effective purpose на момент create, щоб старі invoice links не drift-или після edits.
- Unique `(accountId, slugLower)`; list index — `(accountId, createdAt, _id)`.

### InvoiceSlugCounter

Файл: `apps/api/src/modules/invoices/schemas/invoice-slug-counter.schema.ts`

- Окрема sequence-like collection для monotonic invoice numbers per `(accountId, scope)`.
- Захищає від counter reuse після invoice delete і бере участь в invoice-create transactions.
- `businessId` denormalized тільки для cascade delete.

### SlugReservation

Файл: `apps/api/src/modules/slug-reservation/schemas/slug-reservation.schema.ts` | Contract: `packages/types/src/contracts/slug-reservation.ts`

- Ephemeral paid-upsell hold для бажаного business/account/invoice slug; одна active reservation на user.
- Унікальність імені — `(scopeKey, slugLower)`, де scopes: global business, per-business account, per-account invoice.
- TTL index прибирає rows фоном; read paths вважають реальною валідністю `expiresAt > now`.

### ProcessedWebhookEvent

Файл: `apps/api/src/modules/payments/schemas/processed-webhook-event.schema.ts`

- WayForPay webhook idempotency ledger із unique `(provider, providerEventId)`.
- Two-phase `pending -> applied`; старі `pending` rows є crash-orphans і sweep-яться cleanup service.

### PaymentRecord

Файл: `apps/api/src/modules/payments/schemas/payment-record.schema.ts` | Contract: `packages/types/src/contracts/payments.ts`

- Money-movement history для cabinet і refunds; наповнюється WayForPay webhooks.
- Зберігає provider-internal IDs, але controller явно мапить public shape.
- Amounts і refunds — integer kopecks.

### FailedRecurringRemoval

Файл: `apps/api/src/modules/payments/schemas/failed-recurring-removal.schema.ts`

- Retry queue для failed WayForPay recurring `REMOVE` після cancel/reset/rebind cleanup.
- Unique `(provider, orderReference)` не дає дублювати retry jobs.

## Module Dependency Map

- `AppModule` → global config/throttle/schedule/Mongoose/Redis плюс усі feature modules.
- `AuthModule` ↔ `UsersModule` через `forwardRef`; `AuthModule` навмисно не імпортує `LandingClaimModule`.
- `UsersModule` → `AuthModule`, autonomous `StorageModule`, `SlugReservationModule`; володіє `AvatarController`, але зберігає routes `/storage/avatar/*`.
- `StorageModule` — pure R2 file operations і не імпортує feature modules.
- `BusinessesModule` → `UsersModule`, `QrModule`, `SlugReservationModule`, `StorageModule`; також реєструє Account/Invoice models для counts і cascade deletes.
- One-way payment entity tree: `Users ← Businesses ← Accounts ← Invoices`; немає `Businesses ↔ Accounts` або `Accounts ↔ Invoices` cycles.
- `AccountsModule` → `BusinessesModule`, `QrModule`, `SlugReservationModule`; експортує `AccountAccessGuard`.
- `InvoicesModule` → `BusinessesModule`, `AccountsModule`, `QrModule`, `SlugReservationModule`.
- `LandingClaimModule` → `BusinessesModule`, `AccountsModule`, `UsersModule`, `AuthModule`; володіє orchestration для `POST /auth/magic-link/verify`.
- `OrphanCleanupModule` → `UsersModule`, `BusinessesModule`; `EmailModule` є `@Global()`.
- `PaymentsModule` → `UsersModule`, `BusinessesModule`, WayForPay provider abstraction, payment models.
- `QrModule` — reusable rendering; експортує `QrService` і brand mark baker.
- `AiModule` — standalone public help chat; без `UsersModule` і без executions reservation.
- Web root layout → `Providers` + `AuthInitializer` + `Overlays`; protected layout → host check + `Header` + `ClaimLandingDraftHook` + `AuthGuard`.

## Key Patterns

### Endpoint Creation

Controller + guard/decorator + DTO/Zod pipe + service. JSON responses ідуть через `{ data: ... }`, крім health/hello, PNG QR responses, SSE і WayForPay webhooks. Приклади: `apps/api/src/modules/businesses/businesses.controller.ts`, `apps/api/src/modules/payments/payments.controller.ts`.

### Validation

Write contracts живуть у `packages/types/src/contracts/*`; API DTOs обгортають їх через `createZodDto()` або використовують param-level `new ZodValidationPipe(schema)` для Zod unions. Entity invariants живуть у `packages/types/src/entities/*`; Mongoose schemas переважно тримають structure і indexes.

### Auth And Session

Access JWT живе in-memory у `apps/web/src/shared/api/client.ts`; refresh JWT — cookie `bid_refresh`. Redis-backed refresh family, lockout і magic-link logic живуть у `apps/api/src/modules/auth/auth.service.ts`. `shared/api` публікує `authEvents`, щоб не імпортувати higher FSD layers.

### Onboarding Gate

`apps/api/src/common/interceptors/onboarding.interceptor.ts` блокує authenticated requests до завершення profile onboarding, якщо route/class не має `@SkipOnboarding()`. Web дзеркалить це в `apps/web/src/features/auth/AuthGuard.tsx`.

### Access Levels And Billing Gates

Access level derive-иться у `packages/types/src/contracts/payments.ts` і адаптується в `apps/api/src/common/billing/resolve-access-level.ts`. Hard gates використовують helpers з `apps/api/src/common/billing/assert-access.ts`; soft gates на кшталт brand upload можуть повертати success-with-state.

### Business/Account/Invoice Tree

Business — legal recipient, Account — bank account, Invoice — payment command. Cabinet URLs і public URLs мають ту саму вкладеність: business → account → invoice. Reference files: `apps/api/src/modules/accounts/accounts.module.ts`, `apps/api/src/modules/invoices/invoices.module.ts`.

### Slug, History And Reservations

Editable slugs — case-preserved display values із lowercase lookup fields. Rename пише `*SlugHistory`; paid upsell може створити `SlugReservation`; reconciliation може reset-ити customized slugs і писати history з `redirect: false`. Reference files: `apps/api/src/modules/businesses/businesses.service.ts`, `apps/api/src/modules/slug-reservation/slug-reservation.service.ts`.

### Public Payment Host

`apps/web/src/proxy.ts` rewrite-ить `pay.finly.com.ua` / `pay.finly.local:3000` у internal `app/host-pay/*` routes і блокує cabinet routes на public host. Server Components fetch-ать API через `API_INTERNAL_URL`; public data loaders живуть у `apps/web/src/features/*-public/load*.ts`.

### Public APIs

Public payment endpoints no-auth, мають `@SkipOnboarding()`, strip-яться через shared public Zod schemas і використовують `public-payment` throttle. Browser public clients використовують native `fetch` з `credentials: 'omit'` у `apps/web/src/shared/api/client.ts`.

### QR/NBU Generation

Pure payload builders живуть у `packages/types/src/qr/*`; Node PNG rendering, logo composition і brand mark baking — у `apps/api/src/modules/qr/*`. `QrService.renderForUrl()` і `renderForNbuPayload()` навмисно розділені.

### WayForPay Billing

Catalog статичний у `packages/types/src/contracts/payments.ts`; provider operations живуть за `apps/api/src/modules/payments/interfaces/payment-provider.interface.ts`. Webhook processing потребує Nest `rawBody`, створює `ProcessedWebhookEvent`, transactionally apply-ить side effects, повертає signed WayForPay accept для valid callbacks і queue-ить failed recurring removals.

### Mongo Transactions

Cascade deletes і invoice create/counter allocation використовують `session.withTransaction`; local Mongo має бути replica set. Standalone incompatibility detect-иться через `apps/api/src/common/mongoose/transactions-unsupported.ts`.

### Storage, Avatar And Brand

`StorageModule` — pure Cloudflare R2 transport. Avatar domain живе в `UsersModule`; brand logo domain — у `BusinessesModule`, з active/pending slots і pre-baked QR marks. Reference files: `apps/api/src/modules/users/avatar.service.ts`, `apps/api/src/modules/businesses/brand.service.ts`.

### Frontend Boundaries And UI

Web дотримується `shared → entities → features → widgets → app`, enforce-иться в `apps/web/eslint.config.mjs`. UI поза `shared/ui` має використовувати `Ui*` primitives. Rule sources: `docs/conventions/modular-boundaries.md`, `docs/conventions/ui-primitives.md`, `docs/conventions/design-tokens.md`, `docs/conventions/responsive.md`.

### Overlays

Overlay state живе в owning slice Zustand store, а overlays монтуються один раз у `apps/web/src/app/overlays.tsx`. Rule source: `docs/conventions/overlays.md`.

### Error And Copy Mapping

Backend повертає machine-readable `error.code` через `apps/api/src/common/filters/all-exceptions.filter.ts`; web мапить codes на українські рядки в `apps/web/src/shared/api/mapApiCode.ts`. User-facing copy follow-ить `docs/conventions/tone.md`.

## API Overview

Global prefix: `/api`. Global setup: `ThrottlerGuard`, `OnboardingInterceptor`, `ZodValidationPipe`, `AllExceptionsFilter`, `rawBody: true`, CORS from `WEB_URL`.

**AppController** (`apps/api/src/app.controller.ts`)

- `GET /api` — public — hello probe
- `GET /api/health` — public — health snapshot

**AuthController / MagicLinkVerifyController** (`apps/api/src/modules/auth/auth.controller.ts`, `apps/api/src/modules/landing-claim/magic-link-verify.controller.ts`)

- `GET /api/auth/google` — `AuthGuard('google')` + `SkipOnboarding` — start OAuth
- `GET /api/auth/google/callback` — `AuthGuard('google')` + `SkipOnboarding` — set refresh cookie
- `POST /api/auth/check-email` — public — password availability
- `POST /api/auth/login/password` — public — password login
- `POST /api/auth/magic-link/send` — public — send login/reset/claim link
- `POST /api/auth/magic-link/verify` — public — consume magic link and optional landing claim
- `POST /api/auth/password/reset` — public — reset by token
- `POST /api/auth/password/set` — `JwtActiveGuard` + `SkipOnboarding` — initial password
- `POST /api/auth/password/change` — `JwtActiveGuard` + `SkipOnboarding` — rotate password/session
- `POST /api/auth/password/verify` — `JwtActiveGuard` + `SkipOnboarding` — sensitive action check
- `POST /api/auth/refresh` — cookie-based — rotate refresh
- `POST /api/auth/logout` — cookie-based — revoke refresh

**Users / Avatar** (`apps/api/src/modules/users/users.controller.ts`, `apps/api/src/modules/users/avatar.controller.ts`)

- `GET /api/users/me` — `JwtActiveGuard` + `SkipOnboarding` — current user
- `PATCH /api/users/me` — `JwtActiveGuard` + `SkipOnboarding` — profile/bookkeeper/update redirect stamp
- `DELETE /api/users/me/slug-reservation` — `JwtActiveGuard` + `SkipOnboarding` — release own slug hold
- `POST /api/users/me/accept-terms` — `JwtActiveGuard` + `SkipOnboarding` — accept terms version
- `POST /api/users/account/delete` — `JwtActiveGuard` + `SkipOnboarding` — start delete flow
- `POST /api/users/account/delete/confirm` — `JwtActiveGuard` + `SkipOnboarding` — password delete
- `POST /api/users/account/restore` — `JwtAuthGuard` — restore soft-deleted account
- `POST /api/storage/avatar/upload-url` — `JwtActiveGuard` — presigned R2 URL
- `POST /api/storage/avatar/commit` — `JwtActiveGuard` — bind uploaded avatar
- `DELETE /api/storage/avatar` — `JwtActiveGuard` — remove avatar

**Businesses / Brand** (`apps/api/src/modules/businesses/*controller.ts`)

- `GET /api/businesses/me?context=own|client` — `JwtActiveGuard` — list visible businesses
- `POST /api/businesses/me` — `JwtActiveGuard` — create business
- `GET /api/businesses/me/:slug` — `JwtActiveGuard` + `BusinessAccessGuard` — cabinet detail with counts
- `PATCH /api/businesses/me/:slug` — `JwtActiveGuard` + `BusinessAccessGuard` — update business
- `POST /api/businesses/me/:slug/reset-slug` — same guards — reset to auto slug
- `GET /api/businesses/me/:slug/slug-availability` — same guards + `slug-availability` throttle — check vanity slug
- `POST /api/businesses/me/:slug/slug-reservation` — same guards — hold desired slug
- `DELETE /api/businesses/me/:slug` — same guards — hard cascade delete
- `POST /api/businesses/me/:slug/brand/upload-url` — same guards — presigned logo URL
- `POST /api/businesses/me/:slug/brand` — same guards — commit active/pending brand
- `DELETE /api/businesses/me/:slug/brand` — same guards — delete brand
- `POST /api/businesses/me/:slug/brand/preview` — same guards + `brand-preview` throttle — render preview
- `GET /api/businesses/public/:slug` — public + `SkipOnboarding` — public business view
- `GET /api/businesses/public/:slug/qr/business.png` — public + `SkipOnboarding` — URL QR PNG

**Accounts** (`apps/api/src/modules/accounts/*controller.ts`)

- `GET /api/businesses/me/:slug/accounts` — `JwtActiveGuard` + `BusinessAccessGuard` — list accounts
- `POST /api/businesses/me/:slug/accounts` — same guards — create account
- `GET /api/businesses/me/:slug/accounts/:accountSlug` — same + `AccountAccessGuard` — account detail
- `PATCH /api/businesses/me/:slug/accounts/:accountSlug` — same guards — update account
- `POST /api/businesses/me/:slug/accounts/:accountSlug/reset-slug` — same guards — reset account slug
- `GET /api/businesses/me/:slug/accounts/:accountSlug/slug-availability` — same guards + throttle — check slug
- `POST /api/businesses/me/:slug/accounts/:accountSlug/slug-reservation` — same guards — hold slug
- `DELETE /api/businesses/me/:slug/accounts/:accountSlug` — same guards — hard cascade delete
- `GET /api/businesses/public/:slug/account/:accountSlug` — public — public account view
- `GET /api/businesses/public/:slug/account/:accountSlug/qr/business.png` — public — account URL QR PNG
- `GET /api/businesses/public/:slug/account/:accountSlug/qr/nbu.png?host=primary|legacy` — public — NBU QR PNG

**Invoices** (`apps/api/src/modules/invoices/*controller.ts`)

- `GET /api/businesses/me/:slug/accounts/:accountSlug/invoices?page&limit` — `JwtActiveGuard` + business/account guards — paginated invoices
- `POST /api/businesses/me/:slug/accounts/:accountSlug/invoices` — same guards — create invoice
- `GET /api/businesses/me/:slug/accounts/:accountSlug/invoices/:invoiceSlug` — same + `InvoiceAccessGuard` — invoice detail
- `PATCH /api/businesses/me/:slug/accounts/:accountSlug/invoices/:invoiceSlug` — same guards — update invoice
- `POST /api/businesses/me/:slug/accounts/:accountSlug/invoices/:invoiceSlug/reset-slug` — same guards — reset invoice slug
- `GET /api/businesses/me/:slug/accounts/:accountSlug/invoices/:invoiceSlug/slug-availability` — same guards + throttle — check slug
- `POST /api/businesses/me/:slug/accounts/:accountSlug/invoices/:invoiceSlug/slug-reservation` — same guards — hold slug
- `DELETE /api/businesses/me/:slug/accounts/:accountSlug/invoices/:invoiceSlug` — same guards — hard delete
- `GET /api/businesses/public/:slug/account/:accountSlug/invoices/:invoiceSlug` — public — invoice payment view
- `GET /api/businesses/public/:slug/account/:accountSlug/invoices/:invoiceSlug/qr/business.png` — public — invoice URL QR PNG
- `GET /api/businesses/public/:slug/account/:accountSlug/invoices/:invoiceSlug/qr/nbu.png?host=primary|legacy` — public — invoice NBU QR PNG

**Payments** (`apps/api/src/modules/payments/payments.controller.ts`)

- `GET /api/payments/catalog` — public + `SkipThrottle` + `SkipOnboarding` — pricing catalog
- `POST /api/payments/checkout-session` — `JwtActiveGuard` — WayForPay checkout
- `POST /api/payments/subscription/cancel` — `JwtActiveGuard` — cancel/refund subscription
- `POST /api/payments/subscription/change-plan` — `JwtActiveGuard` — change plan
- `POST /api/payments/subscription/update-card` — `JwtActiveGuard` — re-bind card
- `GET /api/payments/payments?limit=` — `JwtActiveGuard` — recent money movements
- `POST /api/payments/webhook/:provider` — public + `SkipThrottle` — WayForPay webhook

**QR / AI / Reports**

- `GET /api/qr/landing.png` — public + `SkipThrottle` + `SkipOnboarding` — cached landing QR PNG
- `POST /api/qr/preview` — public + `qr-preview` throttle + `SkipOnboarding` — anonymous NBU QR preview
- `POST /api/ai/help/chat` — public + `help-chat` throttle + `HelpChatRateLimitGuard` — SSE help assistant
- `apps/api/src/modules/reports/reports.controller.ts` has no route methods.

## Configuration & Environment

**Loaders and source files**

- API fail-fast loader: `apps/api/src/config/env.ts`
- Web fail-fast loader: `apps/web/src/shared/config/env.ts`
- Next build/proxy/image config: `apps/web/next.config.ts`
- Shared sample: `.env.example`
- API test placeholders: `apps/api/src/test-setup.ts`

**API env: required**

- Runtime/data: `NODE_ENV`, `PORT`, `TRUST_PROXY_HOPS`, `WEB_URL`, `PAY_PUBLIC_URL`, `MONGODB_URI`, `REDIS_URL`
- Auth: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- OAuth/email: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- WayForPay: `WAYFORPAY_MERCHANT_ACCOUNT`, `WAYFORPAY_MERCHANT_SECRET_KEY`, `WAYFORPAY_MERCHANT_DOMAIN`
- Payments flags: `PAYMENTS_SUBSCRIPTION_ENABLED`, `PAYMENTS_ONE_OFF_ENABLED`, `BILLING_DEMO_MODE`
- Auth tuning: `AUTH_PASSWORD_MIN_LENGTH`, `AUTH_LOCKOUT_THRESHOLDS`, `AUTH_LOGIN_ATTEMPTS_TTL_MIN`, `AUTH_MAGIC_LINK_TTL_MIN`, `AUTH_MAGIC_LINK_RATE_LIMIT`, `AUTH_MAGIC_LINK_RATE_WINDOW_MIN`, `AUTH_MAGIC_LINK_DEDUP_SEC`, `ACCOUNT_DELETION_GRACE_DAYS`
- Orphan cleanup: `ORPHAN_REMINDER_FIRST_DAYS`, `ORPHAN_REMINDER_FINAL_DAYS`, `ORPHAN_CLEANUP_DELETION_DAYS`
- Brand cleanup: `BRAND_PENDING_CLEANUP_DAYS`, `BRAND_DEMOTED_CLEANUP_DAYS`
- AI/help: `ANTHROPIC_API_KEY`, `HELP_CHAT_MAX_TOKENS`, `HELP_CHAT_IP_LIMIT`, `HELP_CHAT_DAILY_BUDGET`
- Storage: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`

**Web env: required**

- Public base/API: `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_API_URL`
- Public payment host: `NEXT_PUBLIC_PAY_PUBLIC_URL`
- Payments flags: `NEXT_PUBLIC_PAYMENTS_SUBSCRIPTION_ENABLED`, `NEXT_PUBLIC_PAYMENTS_ONE_OFF_ENABLED`, `NEXT_PUBLIC_BILLING_DEMO_MODE`
- Storage image host: `NEXT_PUBLIC_STORAGE_HOSTNAME`

**Runtime/build env outside loaders**

- `API_INTERNAL_URL` optional для Next rewrites у `apps/web/next.config.ts`, але required at runtime для host-pay Server Component fetches у `loadPublic*View.ts`.
- `WEB_PORT` і `API_PORT` — compose helpers, не app loader vars.

**Env invariants**

- Хоча б один із `PAYMENTS_SUBSCRIPTION_ENABLED` або `PAYMENTS_ONE_OFF_ENABLED` має бути `true`.
- `AUTH_MAGIC_LINK_TTL_MIN * 60 >= AUTH_MAGIC_LINK_DEDUP_SEC`.
- `ORPHAN_REMINDER_FIRST_DAYS < ORPHAN_REMINDER_FINAL_DAYS < ORPHAN_CLEANUP_DELETION_DAYS`, а first reminder має бути не раніше 1 дня.
- `BRAND_PENDING_CLEANUP_DAYS <= BRAND_DEMOTED_CLEANUP_DAYS`.
- `TRUST_PROXY_HOPS` має бути non-negative integer; неправильне значення ламає per-IP throttling behind proxies.
- `MONGODB_URI` має вказувати на replica set для transaction-backed create/delete flows.
- Hostname у `R2_PUBLIC_URL` має дорівнювати `NEXT_PUBLIC_STORAGE_HOSTNAME`.
- `GOOGLE_CALLBACK_URL` має вказувати на web-origin `/api/auth/google/callback`, щоб refresh cookies лишались на web domain.
- `PAY_PUBLIC_URL`, `NEXT_PUBLIC_PAY_PUBLIC_URL` і `PUBLIC_HOSTS` мають описувати ту саму public payment zone.
- `BILLING_DEMO_MODE` / `NEXT_PUBLIC_BILLING_DEMO_MODE` мають бути `false` для live payments.

**Fail-fast policy**

- Rule source: `docs/conventions/fail-fast.md`.
- Нова env var має оновити відповідний loader, `.env.example`, `.env` і `apps/api/src/test-setup.ts`, якщо API code імпортує loader.
- Web `NEXT_PUBLIC_*` reads мають використовувати direct `process.env.VAR`, щоб Next inline-ив значення.

**Infra**

- `docker-compose.dev.yml` стартує Redis + API + web; MongoDB зовнішня через `MONGODB_URI`.
- `docker-compose.yml` містить Redis, API, web і profile `migrations` для one-shot DB scripts.
- Docker і compose flows збирають `@finly/types` до app builds.

## Common Commands

- `pnpm dev` — run all workspace dev tasks through Turbo
- `pnpm build` — build apps and packages
- `pnpm lint` — lint workspace
- `pnpm format` — Prettier repo
- `pnpm test` — workspace tests
- `pnpm --filter api dev|build|test|test:e2e|test:cov|email:dev` — API workflows
- `pnpm --filter web dev|build|test|lint` — web workflows
- `pnpm --filter @finly/types build|dev|test` — shared contracts
- `pnpm --filter api migration:all` — run all registered API migrations
- `docker compose -f docker-compose.dev.yml up --build` — local Redis + apps
- `docker compose --profile migrations run --build --rm api-migrations` — production migration container
- `docker compose up --build -d` — production-like stack

## Testing Strategy

- API unit specs живуть поруч із source у `apps/api/src/**/*.spec.ts`; Jest maps `@finly/types` to source.
- API e2e specs живуть у `apps/api/test/*.e2e-spec.ts` і використовують MongoMemoryServer/MongoMemoryReplSet залежно від transaction needs.
- Web використовує Jest + jsdom через `apps/web/jest.config.ts`; specs покривають proxy routing, host-pay pages, auth, stores, API clients, public loaders і UI primitives.
- `packages/types` tests покривають contracts, entities, validation і QR payload logic.

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
- Перед змінами у user-facing copy, env/config, FSD boundaries, overlays, shared UI, design tokens або responsive layout перечитуй відповідний convention file у `docs/conventions/`.
- Product single-locale Ukrainian. Не додавай `next-intl`, locale URL segments або message catalogs без ADR-scale migration.
- Web boundary rules enforce-яться в `apps/web/eslint.config.mjs`; немає global `src/stores/`, а `shared/` не імпортує higher FSD layers.
- UI поза `shared/ui/` має використовувати covered `Ui*` primitives замість native controls.
- Runtime data layer — Mongoose schemas у `apps/api/src/modules/**/schemas`; `prisma/schema.prisma` відсутній.
- Product docs у `docs/product/` є working drafts; implemented behavior визначається code, schemas і tests.

## Known Complexities

- `README.md`, `apps/web/README.md`, частина sprint docs і comments ще згадують `app/[locale]`, `next-intl`, Stripe або `middleware.ts`; current code — root App Router, single-locale UA, WayForPay і `apps/web/src/proxy.ts`.
- Cabinet `/ai/chat`, chat history і AI reservation endpoints видалені; current AI API — тільки public stateless `POST /api/ai/help/chat`. `ExecutionTransaction` лишився credit ledger, але controller не expose-ить spend/history routes.
- Public host routing має чотири branches: bare `/`, `/{business}`, `/{business}/{account}`, `/{business}/{account}/{invoice}`. Business з одним account redirect-ить через 307, не 308, бо цей state може змінитись.
- `API_INTERNAL_URL` не входить у web fail-fast loader, але public Server Component rendering падає без нього.
- Public/cabinet auth isolation залежить від `PUBLIC_HOSTS`, `PAY_PUBLIC_URL`, `NEXT_PUBLIC_PAY_PUBLIC_URL` і local `/etc/hosts` для `pay.finly.local`.
- Web proxy auth decisions дивляться на cookie presence (`bid_refresh`, `bid_account_deleted`), а не на token validation; stale cookies чистяться client/server auth flows.
- Mongo transactions require replica set. Standalone local Mongo ламає cascade/create transaction flows, навіть якщо simple reads працюють.
- WayForPay webhook handling залежить від Nest `rawBody` і `POST /api/payments/webhook/wayforpay`; Stripe portal/customer code у current runtime немає.
- Access reconciliation може block-ити public pages, reset-ити customized slugs, demote-ити brand slots і stamp-ити `reconcileRequiredAt`; billing і business changes зазвичай мають запускати reconciliation під shared billing lock.
- Avatar endpoints живуть під `/storage/avatar/*`, але controller resident у `UsersModule`; `StorageModule` навмисно autonomous R2 transport.
- R2 avatar upload використовує native `fetch`, не `apiClient`; uploaded `Content-Type` має точно збігатися з presigned contract.
- `@finly/types` runtime resolves from `dist`; clean app-only runs часто потребують спочатку `pnpm --filter @finly/types build`.
