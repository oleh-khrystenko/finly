# Finly

> SaaS для українських ФОП, бухгалтерів і платників: створює публічні платіжні сторінки, NBU QR, рахунки та персоналізовані податкові платежі.

## Tech Stack

| Шар                  | Технологія                                | Версія / роль                                       |
| -------------------- | ----------------------------------------- | --------------------------------------------------- |
| Core                 | TypeScript, Node.js, pnpm, Turborepo      | TS 5.9, Node 20, pnpm 10 workspaces                 |
| Web                  | Next.js, React, Zustand, Tailwind CSS     | Next 16 App Router, React 19, FSD, single-locale UA |
| API                  | NestJS, Passport, nestjs-zod              | Nest 11, JWT + Google OAuth, global Zod pipe        |
| Data                 | MongoDB, Mongoose, Redis, ioredis         | Mongoose 8, transactions, locks, sessions, limits   |
| Payments             | monobank «Плата»                          | Tokenized card, own billing clock, webhooks         |
| Storage / email / AI | Cloudflare R2, Resend, Anthropic          | Media, transactional email, public help chat        |
| Shared contracts     | `@finly/types`, Zod                       | Entities, DTO contracts, NBU payloads               |
| Tests                | Jest, Supertest, MongoMemoryServer, jsdom | Unit, e2e, component, contract tests                |

## Architecture Overview

Модульний monorepo-monolith складається з Nest API, тонкого Next App Router web і спільного пакета Zod-контрактів. API є system of record; web дотримується FSD-напрямку `shared → entities → features → widgets → app`. Основне доменне дерево має односторонню залежність `Users ← Businesses ← Accounts ← Invoices`; крос-доменні сценарії винесені в orchestration-модулі. Публічна pay-зона і кабінет обслуговуються одним Next-застосунком із host-aware routing у `apps/web/src/proxy.ts`. `ReportsModule` лишається scaffold-only; решта модулів у `AppModule` мають робочі маршрути або фонові задачі.

## Project Structure

```text
apps/
├── api/src/
│   ├── main.ts, app.module.ts
│   ├── config/          # env і константи
│   ├── common/          # guards, filters, infra
│   └── modules/         # доменні модулі
├── api/scripts/         # міграції й assets
├── web/src/
│   ├── app/             # App Router routes
│   ├── entities/        # доменні зрізи
│   ├── features/        # користувацькі сценарії
│   ├── widgets/         # складені блоки
│   └── shared/          # api, config, ui
packages/
└── types/src/           # контракти й NBU QR
docs/
├── conventions/         # обов'язкові правила
└── server-playbook/     # операційні інструкції
```

## Domain Model

### User

Файл: `apps/api/src/modules/users/schemas/user.schema.ts` | Zod: `packages/types/src/entities/user.ts`

- `role` є системною роллю; `worksAsBookkeeper` — окрема capability.
- Профіль, terms, soft-delete, reminders і post-login target вбудовані; білінгу в `User` більше немає.
- Restore працює для soft-deleted користувача; остаточне видалення каскадно чистить його дані.

### Business

Файл: `apps/api/src/modules/businesses/schemas/business.schema.ts` | Zod: `packages/types/src/entities/business.ts`

- Власник може бути `null` для клієнта бухгалтера; системний отримувач має `ownerId: null`, порожніх managers і керується адмінкою.
- Case-preserved `slug` має окремий `slugLower`; унікальність tax ID навмисно scoped на власника/менеджера, не глобальна.
- Зберігає каталог/publicity, denormalized brand access і `active`/`pending` brand slots.

### Account

Файл: `apps/api/src/modules/accounts/schemas/account.schema.ts` | Zod: `packages/types/src/entities/account.ts`

- Належить Business; унікальні `(businessId, slugLower)` та `(businessId, iban)`.
- IBAN незмінний після створення; `bankCode` виводиться з нього один раз.
- Має власну видимість у каталозі та default preset для invoice slug.

### Invoice

Файл: `apps/api/src/modules/invoices/schemas/invoice.schema.ts` | Zod: `packages/types/src/entities/invoice.ts`

- Належить Account і денормалізує `businessId`; slug унікальний лише в межах account.
- `payeeSnapshot` фіксує реквізити на момент створення; legacy `null` читається через fallback.
- Сума зберігається цілими копійками; pagination використовує `(createdAt, _id)`.

### BusinessSlugHistory / AccountSlugHistory / InvoiceSlugHistory

Файли: `apps/api/src/modules/{businesses,accounts,invoices}/schemas/*-slug-history.schema.ts`

- Старі case-insensitive slug-и утримуються 90 днів для redirect grace та anti-squatting.
- `redirect: false` резервує ім'я без публічного redirect після втрати доступу.
- Namespace: global для Business, per-business для Account, per-account для Invoice.

### InvoiceSlugCounter

Файл: `apps/api/src/modules/invoices/schemas/invoice-slug-counter.schema.ts`

- Monotonic sequence на `(accountId, scope)` не дозволяє повторно використати номер після видалення Invoice.
- Бере участь у транзакції створення; `businessId` потрібен для cascade delete.

### SlugReservation

Файл: `apps/api/src/modules/slug-reservation/schemas/slug-reservation.schema.ts` | Contract: `packages/types/src/contracts/slug-reservation.ts`

- Одна активна paid-upsell бронь на user; унікальність також контролюється за `(scopeKey, slugLower)`.
- TTL очищає записи фоном, але read paths завжди перевіряють `expiresAt > now`.

### BillingProfile

Файл: `apps/api/src/modules/payments/schemas/billing-profile.schema.ts` | Contract: `packages/types/src/contracts/billing-profile.ts`

- Окрема one-per-user сутність із tokenized card, billing-clock state і складами Brand/Documents.
- Secret `cardToken`/`walletId` ніколи не серіалізуються у web; controller повертає явний public view.
- Прикріплення бізнесів і durable reconciliation markers визначають доступ per-business.

### CreditLedgerEntry

Файл: `apps/api/src/modules/payments/schemas/credit-ledger-entry.schema.ts` | Contract: `packages/types/src/contracts/payments.ts`

- Append-only книга кредитів із `balanceAfter`; `idempotencyKey` глобально unique.
- Зберігає реальну собівартість обробки окремо від видимого числа кредитів.

### PaymentRecord

Файл: `apps/api/src/modules/payments/schemas/payment-record.schema.ts` | Contract: `packages/types/src/contracts/payments.ts`

- Claim-first історія грошових рухів; unique pending `orderReference` не дозволяє billing clock списати двічі.
- Provider IDs не виходять напряму назовні; суми й повернення — integer kopecks.
- `pendingEffect` відкладає side effect нетермінального token charge до reconciliation.

### ProcessedWebhookEvent

Файл: `apps/api/src/modules/payments/schemas/processed-webhook-event.schema.ts`

- Idempotency ledger monobank із unique `(provider, providerEventId)` і двофазним `pending → applied`.
- Crash-orphan `pending` записи прибирає cleanup service.

### Guide

Файл: `apps/api/src/modules/guides/schemas/guide.schema.ts` | Zod: `packages/types/src/entities/guide.ts`

- Admin-authored global lowercase slug; статуси draft/published і pillar/cluster зв'язок.
- Контент зберігається блоками; публікація веде окремі publication dates.
- Organic clicks синхронізуються з Google Search Console.

### Payer

Файл: `apps/api/src/modules/payers/schemas/payer.schema.ts` | Zod: `packages/types/src/entities/payer.ts`

- Приватний список платників користувача; `(userId, taxId)` унікальний.
- Остаточне видалення User каскадно видаляє персональні дані платників.

## Module Dependency Map

- `AuthModule ↔ UsersModule` через `forwardRef`; це єдиний навмисний Nest cycle.
- `UsersModule → AuthModule, StorageModule, SlugReservationModule, PayersModule`; BillingProfile model реєструється напряму для hard-delete без залежності від PaymentsModule.
- `BusinessesModule → UsersModule, QrModule, SlugReservationModule, StorageModule`; Account/Invoice/BillingProfile schemas реєструє напряму для counts, cascade і reconciliation.
- `AccountsModule → BusinessesModule, QrModule, SlugReservationModule`; експортує `AccountAccessGuard`.
- `InvoicesModule → BusinessesModule, AccountsModule, QrModule, SlugReservationModule`.
- `PaymentsModule → UsersModule, BusinessesModule`; експортує billing profile і catalog services.
- `LandingClaimModule → BusinessesModule, AccountsModule, UsersModule, AuthModule`; володіє `POST /auth/magic-link/verify`.
- `AdminPayeesModule → BusinessesModule, AccountsModule`; перевикористовує їхні сервіси для system payees.
- `GuidesModule → StorageModule`; `OrphanCleanupModule → UsersModule, BusinessesModule`.
- `PayersModule`, `SlugReservationModule`, `StorageModule`, `QrModule`, `AiModule` автономні; `EmailModule` глобальний.

## Key Patterns

### Endpoint і відповідь

Controller + guard/decorator + shared Zod DTO + service. JSON відповіді мають `{ data: ... }`, крім health, XML, PNG, SSE і webhook ack. Приклади: `apps/api/src/modules/businesses/businesses.controller.ts`, `apps/api/src/modules/guides/guides-admin.controller.ts`.

### Валідація

Write contracts живуть у `packages/types/src/contracts/`; API DTO обгортає schema через `createZodDto()`. Для union використовуй param-level `ZodValidationPipe`. Приклад: `apps/api/src/modules/admin-payees/admin-payees.controller.ts`.

### Auth і ролі

`JwtActiveGuard` — стандартний authenticated guard і блокує soft-deleted; `JwtAuthGuard` потрібен лише restore. `AdminGuard` завжди ставиться після `JwtActiveGuard`. Файли: `apps/api/src/common/guards/`.

Access JWT живе in-memory у `apps/web/src/shared/api/client.ts`, refresh JWT — у `bid_refresh` cookie; refresh families, magic links і lockout state зберігаються в Redis. Shared API публікує auth events замість імпорту higher FSD layers.

### Onboarding

Global `OnboardingInterceptor` блокує authenticated routes до заповнення profile; auth, restore, staff і незалежні від ФОП сценарії позначають `@SkipOnboarding()`. Файл: `apps/api/src/common/interceptors/onboarding.interceptor.ts`.

### Throttling

Named buckets і per-user limits централізовані у `apps/api/src/common/http/throttle-policy.ts`. Для окремого bucket завжди використовуй `skipThrottlersExcept(...)`; ручні skip maps дрейфують при додаванні bucket.

### Billing access

Entitlement визначається складами `BillingProfile`, а Business читає reconciled `brandedAt`. Зміни capacity, attachment або status мають іти під shared billing lock і запускати reconciliation. Файли: `apps/api/src/modules/payments/billing-profile.service.ts`, `apps/api/src/modules/businesses/reconciliation.service.ts`.

### Slug lifecycle

Case-preserved slug + lowercase lookup, history, reservation і reset реалізовані симетрично на трьох рівнях. Reference services: `apps/api/src/modules/businesses/businesses.service.ts`, `apps/api/src/modules/accounts/accounts.service.ts`, `apps/api/src/modules/invoices/invoices.service.ts`.

### Mongo transactions

Create/cascade/billing atomicity використовує `session.withTransaction`; помилку standalone Mongo мапить `apps/api/src/common/mongoose/transactions-unsupported.ts`. Не замінюй транзакції послідовними записами.

### Public host

`apps/web/src/proxy.ts` розрізняє cabinet і pay host, rewrite-ить 0–3 сегменти у `app/host-pay` та закриває cabinet routes на pay host. Список host-ів походить з `PAY_PUBLIC_URL`, а не з константи.

### Public data і кеш

Public payment loaders використовують server-side `API_INTERNAL_URL` і `cache: 'no-store'`; guides використовують tagged cache з on-demand revalidation. Файли: `apps/web/src/features/business-public/loadPublicView.ts`, `apps/web/src/features/guides/loadGuides.ts`.

### QR / NBU

Pure payload builders живуть у `packages/types/src/qr/`; PNG rendering, logo composition і brand mark baking — у `apps/api/src/modules/qr/`. URL QR і NBU payload rendering є різними методами `QrService`.

### Frontend межі та UI

Правила FSD, UI primitives, overlays, design tokens, forms і responsive layout: `docs/conventions/README.md`. Межі додатково enforce-ить `apps/web/eslint.config.mjs`.

### API errors і тексти

API повертає machine-readable `error.code`; web мапить його на український текст у `apps/web/src/shared/api/mapApiCode.ts`. Усі user-facing тексти підпорядковуються `docs/conventions/tone.md`.

### Storage

`StorageModule` виконує лише R2 file operations; avatar domain живе в Users, brand — у Businesses, guide images — у Guides. Файли: `apps/api/src/modules/storage/storage.service.ts`, `apps/api/src/modules/users/avatar.service.ts`.

## API Overview

Global prefix: `/api`. У списках guard указаний на групі; `Skip` означає `@SkipOnboarding()`.

### App і auth

- Public: `GET /`, `GET /health` — probes.
- Public: `POST /auth/check-email`, `/login/password`, `/magic-link/send`, `/magic-link/verify`, `/password/reset` — auth flows.
- Google guard + Skip: `GET /auth/google`, `/auth/google/callback` — OAuth.
- `JwtActiveGuard` + Skip: `POST /auth/password/set`, `/change`, `/verify` — password management.
- Cookie session: `POST /auth/refresh`, `/logout` — rotate/revoke refresh.

### Users, avatar, payers

- `JwtActiveGuard` + Skip: `GET|PATCH /users/me`, `DELETE /users/me/slug-reservation`, `POST /users/me/accept-terms`.
- `JwtActiveGuard` + Skip: `POST /users/account/delete`, `/delete/confirm`; `JwtAuthGuard`: `POST /users/account/restore`.
- `JwtActiveGuard`: `POST /storage/avatar/upload-url`, `/avatar/commit`; `DELETE /storage/avatar`.
- `JwtActiveGuard` + Skip: `GET|POST /payers`, `PATCH|DELETE /payers/:id`; `GET /payer-sources`.

### Businesses і brand

- `JwtActiveGuard`: `GET|POST /businesses/me` — list/create.
-   - `BusinessAccessGuard`: `GET|PATCH|DELETE /businesses/me/:slug`, `POST /reset-slug`, `GET /slug-availability`, `POST /slug-reservation`.
-   - `BusinessAccessGuard`: `POST|DELETE /businesses/me/:slug/publicity-request`, `PATCH /catalog-visibility`.
-   - `BusinessAccessGuard`: `POST /businesses/me/:slug/brand/upload-url`, `POST|DELETE /brand`, `POST /brand/preview`.
- Public + Skip: `GET /businesses/public/catalog`, `/sitemap.xml`, `/:slug`, `/:slug/qr/business.png`.

### Accounts

- `JwtActiveGuard + BusinessAccessGuard`: `GET|POST /businesses/me/:slug/accounts`.
-   - `AccountAccessGuard`: `GET|PATCH|DELETE /.../accounts/:accountSlug`, `POST /reset-slug`, `GET /slug-availability`, `POST /slug-reservation`, `PATCH /catalog-visibility`.
- Public + Skip: `GET /businesses/public/:slug/account/:accountSlug`, `/qr/business.png`, `/qr/nbu.png`.
- Public personalized bucket: `GET /.../:accountSlug/personalized-links`, `/qr/personalized.png`.

### Invoices

- `JwtActiveGuard + BusinessAccessGuard + AccountAccessGuard`: `GET|POST /businesses/me/:slug/accounts/:accountSlug/invoices`.
-   - `InvoiceAccessGuard`: `GET|PATCH|DELETE /.../invoices/:invoiceSlug`, `POST /reset-slug`, `GET /slug-availability`, `POST /slug-reservation`.
- Public + Skip: `GET /businesses/public/:slug/account/:accountSlug/invoices/:invoiceSlug`, `/qr/business.png`, `/qr/nbu.png`.

### Payments

- Public + Skip: `GET /payments/catalog`; public raw-body: `POST /payments/webhook/:provider`.
- `JwtActiveGuard`: `GET /payments/profile`, `/payments/payments`, `/payments/credits/ledger`.
- `JwtActiveGuard`: `POST /payments/checkout`, `/capacity`, `/attach`, `/detach`, `/credits/buy`, `/calculator`.
- `JwtActiveGuard`: `POST /payments/subscription/cancel`, `/subscription/resume`.

### Guides і admin

- Public content bucket: `GET /guides/public`, `/sitemap/slugs`, `/:slug`.
- `JwtActiveGuard + AdminGuard` + Skip: `GET|POST /admin/guides`, image upload/commit, organic sync, reorder, item CRUD, draft/publish/unpublish.
- `JwtActiveGuard + AdminGuard` + Skip: `/admin/payees` CRUD, nested account CRUD і catalog visibility.
- `JwtActiveGuard + AdminGuard` + Skip: `GET /admin/publicity`, `/approved`, `POST /:slug/approve`, `/:slug/reject`.

### QR, AI, reports

- Public + Skip: `GET /qr/landing.png`, `POST /qr/preview`.
- Public + Skip + `HelpChatRateLimitGuard`: `POST /ai/help/chat` — SSE.
- `ReportsController` не має route methods.

## Configuration & Environment

### Джерела

- API loader: `apps/api/src/config/env.ts`; web client loader: `apps/web/src/shared/config/env.ts`.
- Next build/rewrites/images: `apps/web/next.config.ts`; приклад значень: `.env.example`.
- Усі env required, якщо їх читає відповідний процес; fallback заборонений правилами `docs/conventions/fail-fast.md`.

### API required

- Runtime: `NODE_ENV`, `API_PORT`, `TRUST_PROXY_HOPS`, `WEB_URL`, `PAY_PUBLIC_URL`, `REVALIDATE_SECRET`.
- Data/auth: `MONGODB_URI`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`.
- OAuth/email: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.
- Payments/AI: `MONOBANK_TOKEN`, `ANTHROPIC_API_KEY`.
- Guides analytics: `GSC_SITE_URL`, `GSC_CLIENT_EMAIL`, `GSC_PRIVATE_KEY`.
- Storage: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`.

### Web required і похідні

- `WEB_URL`, `PAY_PUBLIC_URL`, `R2_PUBLIC_URL` читає `next.config.ts`; перші два проростають у client bundle як `NEXT_PUBLIC_BASE_URL` і `NEXT_PUBLIC_PAY_PUBLIC_URL`.
- `REVALIDATE_SECRET` required runtime для internal guide revalidation route і має byte-for-byte збігатися з API.
- `API_INTERNAL_URL` умовно вмикає `/api` rewrite під час build, але фактично required runtime для server loaders public payments, catalog, billing catalog і guides.
- `WEB_PORT`, `PAY_PORT` — compose helpers; app loaders їх не читають. `PAY_PORT` потрібен лише dev, де pay-зона — другий port mapping того самого web.

### Feature flags і константи

- Env feature flags відсутні. Billing universes задає `BILLING_UNIVERSE_ENABLED` у `apps/api/src/config/billing.config.ts`; web demo banner — `BILLING_DEMO_MODE` у `apps/web/src/shared/config/billing.ts`.
- Ціни, ліміти й строки cleanup є code constants у `apps/api/src/config/`; зміна потребує build/deploy, не нового env.

### Fail-fast invariants

- `TRUST_PROXY_HOPS` — невід'ємне ціле; помилка змінює IP semantics rate limits.
- `PAY_PUBLIC_URL` мусить лежати під cookie domain, виведеним із `WEB_URL`; web додатково забороняє однакові cabinet/pay hosts.
- `GSC_PRIVATE_KEY` зберігається одним рядком з `\n`; loader розгортає переноси.
- `MONGODB_URI` має вказувати на replica set для transaction-backed flows.
- Нова API env var синхронізується з loader, `.env.example`, локальним `.env` і `apps/api/src/test-setup.ts`; `NEXT_PUBLIC_*` читаються лише direct `process.env.NAME`.

## Common Commands

- `pnpm dev|build|lint|test` — весь workspace через Turbo; `pnpm format` — Prettier.
- `pnpm --filter api dev|build|test|test:e2e|test:cov|email:dev` — API.
- `pnpm --filter web dev|build|test|lint` — web.
- `pnpm --filter @finly/types build|dev|test` — shared contracts.
- `pnpm --filter api migration:all` — зареєстровані production migrations; destructive legacy drop запускається окремо.
- `docker compose -f docker-compose.dev.yml up --build` — local Redis + apps із зовнішнім Mongo.
- `docker compose --profile migrations run --build --rm api-migrations` — production migrations.
- `docker compose up --build -d` — production-like stack.

## Testing Strategy

- API unit specs: `apps/api/src/**/*.spec.ts`; migrations specs: `apps/api/scripts/migrations/*.spec.ts`.
- API e2e: `apps/api/test/*.e2e-spec.ts`; transaction cases використовують `MongoMemoryReplSet` через `apps/api/src/test-utils/mongo.ts`.
- Web: Jest + jsdom, specs поруч із routes/features/shared; особливо критичні `apps/web/src/proxy.spec.ts` і public loaders.
- Shared contracts: `packages/types/src/**/*.spec.ts`; API Jest мапить `@finly/types` на source, runtime apps — на `dist`.

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

- Єдине джерело repo-wide правил: `docs/conventions/README.md`; перед змінами перечитуй релевантний файл.
- Product single-locale Ukrainian: не додавай `next-intl`, locale segments або message catalogs без окремої ADR-міграції.
- Web imports мають іти лише `shared → entities → features → widgets → app`; UI поза `shared/ui` використовує `Ui*` primitives.
- Runtime data layer — Mongoose schemas у `apps/api/src/modules/**/schemas`; `prisma/schema.prisma` у репозиторії відсутній.
- Product docs є working drafts; implemented behavior визначають code, schemas і tests.
- Перед новим модулем або endpoint перевір аналогічний чинний модуль і shared contracts; не дублюй provider/service у downstream module.

## Known Complexities

- `AuthModule ↔ UsersModule` потребує обох `forwardRef`. `MagicLinkVerifyController` навмисно живе в `LandingClaimModule`, щоб не відновити CJS cycle через Businesses/Accounts.
- Cabinet/pay session cookie має domain, похідний від `WEB_URL`; proxy бачить лише наявність cookie, не валідність token. Остаточна перевірка й очищення stale cookie відбуваються в auth flows.
- Dev pay-зона — `localhost` на окремому `PAY_PORT`, не вигаданий TLD: Google OAuth приймає localhost callback, а cookie scope не розділяє порти.
- Pay host підтримує лише `/`, `/{business}`, `/{business}/{account}`, `/{business}/{account}/{invoice}`. Business з одним account дає 307 і `no-store`, бо кількість accounts може змінитися.
- Next matcher пропускає paths із крапкою як static; protected layout робить додаткову host-перевірку. Не прибирай defense-in-depth, змінюючи proxy.
- Public Next server fetches приходять в API з одного container IP. Тому public named buckets високі, cabinet IP-throttle скипнутий, а sensitive cabinet lookup лімітується за userId.
- monobank webhook signature перевіряється на exact `req.rawBody`; `rawBody: true` у `apps/api/src/main.ts` є обов'язковим.
- Billing керується нашим clock, не monobank. Нетермінальний результат зупиняє або відкладає side effect; не трактуй HTTP success як завершений платіж.
- Бізнес може бути прикріплений до billing profiles кількох платників. Reconciliation знімає `brandedAt` лише коли не лишилося жодного активного attachment.
- Mongo standalone дозволяє прості reads, але ламає create/cascade/billing transactions; local і test transaction flows потребують replica set.
- Guide publish викликає API → web revalidation із `REVALIDATE_SECRET`; неправильний secret залишає Next cache застарілим, навіть якщо Mongo вже оновлено.
- R2 upload `Content-Type` має точно збігатися з presigned contract; avatar upload у web використовує native `fetch`, не authenticated API client.
- `@finly/types` runtime resolves із `dist`; після clean app-only запуску спершу виконай `pnpm --filter @finly/types build`.
- Старі README/sprint docs можуть згадувати `next-intl`, Stripe, `/dashboard`, `middleware.ts` або embedded user billing; current sources — root App Router, monobank, `proxy.ts`, окремий `BillingProfile`.
