# Finly

> SaaS для українських ФОП, бухгалтерів і платників податків — платіжні QR-коди та посилання за стандартом НБУ, публічні pay-сторінки, каталог перевірених отримувачів; у планах — зберігання документів із AI-тегуванням.

## Tech Stack

| Шар        | Технологія                                                                      | Версія                               |
| ---------- | ------------------------------------------------------------------------------- | ------------------------------------ |
| Core       | TypeScript, Node.js, pnpm, Turborepo                                            | TS 5.9, Node 20, pnpm 10.30          |
| Frontend   | Next.js (App Router + Turbopack), React, Zustand, Tailwind                      | Next 16, React 19.2, Zustand 5, Tw 4 |
| Forms      | React Hook Form + Zod resolver                                                  | RHF 7.72                             |
| Backend    | NestJS, Mongoose, ioredis, Passport, nestjs-zod                                 | NestJS 11.1, Mongoose 8              |
| Validation | Zod (shared contracts у `packages/types`)                                       | Zod 4.3                              |
| AI         | Anthropic SDK — лише публічний help-assistant                                   | SDK 0.80                             |
| Payments   | monobank «Плата» (checkout + токен; абстракція `IPaymentProvider`)              | —                                    |
| Email      | Resend + React Email                                                            | 6.9                                  |
| Storage    | Cloudflare R2 (S3 SDK + presigner), `sharp`                                     | SDK 3, sharp 0.34                    |
| QR / медіа | `qrcode`, `sharp` (overlay), `opentype.js` (бренд-марка), `jsqr` (test)         | qrcode 1.5                           |
| SEO-дані   | Google Search Console API через `google-auth-library` (органічні кліки гайдів)  | 10.9                                 |
| Content    | `react-markdown` + `remark-gfm` (help-статті, блоки гайдів)                     | 10.1                                 |
| Тести      | Jest, Supertest, MongoMemoryServer / MongoMemoryReplSet, @testing-library/react | Jest 30.2                            |

## Architecture Overview

Monorepo з трьома workspace: `apps/api` (NestJS — system of record), `apps/web` (Next.js — тонкий клієнт), `packages/types` (shared Zod contracts). Frontend організовано за Feature-Sliced Design. Один Next.js project обслуговує два host-и (кабінет `finly.com.ua` + публічна pay-зона `pay.finly.com.ua`) через host-aware `proxy.ts` (Next 16 rename of `middleware.ts`) з 3-сегментним матрьошковим routing-ом; сесія спільна для обох хостів (cookie на батьківському домені). Доменне ядро — one-way DAG `User ← Business ← Account ← Invoice` з editable vanity-slug-ами та anti-squatting history. Білінг самокерований: наш `BillingClockService` (cron) веде цикл, monobank виконує лише checkout / списання за токеном; тарифна модель — два незалежні «всесвіти» (Бренд = поштучні слоти бізнесів, Документи = кредити, за конфіг-прапором вимкнені). Є адмін-поверхня (`role: admin`): системні отримувачі, черга запитів на публічність, конструктор SEO-гайдів. Модуль `reports` — scaffold без ендпоінтів; документне сховище (епік Phase 2) ще не реалізоване.

## Project Structure

```
apps/
├── api/
│   ├── src/
│   │   ├── main.ts, app.module.ts, app.controller.ts
│   │   ├── config/          # env.ts (fail-fast) + типізовані продукт-конфіги
│   │   ├── common/          # billing, decorators, filters, guards, http, interceptors,
│   │   │                    # intl, modules (Redis), mongoose, services
│   │   └── modules/         # auth, users, email, businesses, accounts, invoices,
│   │                        # payments, slug-reservation, admin-payees, payers, guides,
│   │                        # qr, storage, ai, landing-claim, orphan-cleanup, reports
│   ├── test/                # e2e specs + jest-e2e.json
│   └── scripts/             # drop-dev-db, generate-* assets, migrations/
├── web/src/
│   ├── app/                 # лендінг, auth, (protected)/{business,billing,profile,admin},
│   │                        # help, guides, avtor, host-pay/…, billing-return, internal
│   ├── entities/            # user, author, brand, business, guide, help-article,
│   │                        # invoice, navigation, payer, qr-landing-draft
│   ├── features/            # auth, billing, profile, payers, catalog, brand-logo,
│   │                        # business-*, account-*, invoice-*, admin-*, guides, help-*
│   ├── widgets/             # header, cabinet-shell, public-*, help-footer, landing-*
│   ├── shared/              # api, ui, config, lib, seo, styles, icons, fonts, types
│   └── proxy.ts             # host-aware routing (Branch A0–A3/B/C) + auth cookie checks
packages/
└── types/src/               # constants, enums, entities, contracts, validation, utils, qr, help
docs/
├── conventions/             # tone, fail-fast, modular-boundaries, ui-primitives,
│                            # design-tokens, overlays, responsive, forms, subdomains
├── manual-checks/           # UAT-чекліст (живі банк-додатки, друк, малі екрани)
├── product/                 # business-flow, qr-decisions, qr-custom-branding, qr-spec, tech-backlog
├── server-playbook/         # bootstrap, deploy, caddy, backups, runbook
└── sprints/                 # 01-foundation … 30-shared-session-payer-profile
```

> `docs/sprints/README.md` відстає від коду (спринти 27–30 позначені «не стартував», хоча реалізовані). Джерело правди — код.

## Domain Model

### User

Файл: `apps/api/src/modules/users/schemas/user.schema.ts` | Zod: `packages/types/src/entities/user.ts`

- Soft-delete: `deletedAt` + `accountDeletionRequestedAt` (grace period, cron hard-delete)
- `role: UserRole` (`user` | `admin`) — default працює лише на insert, legacy-документи нормалізуються на read (`user-profile.mapper.ts`, `AdminGuard`)
- Білінгу на користувачі **немає** — переїхав у окрему сутність `BillingProfile`; «виконань»/executions ledger знесено разом з ним
- `profile.middleName` — по батькові для податкових сторінок; власного РНОКПП немає (живе на отримувачі-фізособі, читається через `/payer-sources`)
- `worksAsBookkeeper` — capability, не роль; `profileCompletionReminders` — cron-only stamps orphan-cleanup; `pendingPostLoginTarget` — deep-link recovery
- Sparse index: `provider.id`

### Business («отримувач»)

Файл: `apps/api/src/modules/businesses/schemas/business.schema.ts` | Zod: `packages/types/src/entities/business.ts`

- `type` immutable post-creation; top-level `taxId` (формат per-type); `taxationSystem` + `isVatPayer` coupled з `requiresTaxation(type)`
- `slug` (case-preserved) + `slugLower` (unique) + `slugCustomized` (vanity vs авто — реконсиляція скидає лише кастомні)
- `ownerId: ObjectId | null` + `managers[]` — null-owner режим бухгалтера
- `brandedAt: Date | null` — денормалізований прапор «у активному Бренд-складі»; гейтинг slug/логотипа і публічний рендер читають саме його, entitlement наживо не резолвлять
- `brand: { active, pending }` — два слоти кастомного бренду (оригінал + дві пре-композовані марки); pending переживає checkout і згасання тарифу
- Публічний каталог: `isSystem` (створений адміном; `ownerId: null`, дозволені маркери підстановки у `paymentPurposeTemplate`), `catalogVisible`, `publicityStatus` + `publicity*At`/`RejectionReason`, `catalogCategory`
- `claimIdempotencyKey` — anon-claim dedup
- Indexes: unique `slugLower`; **два partial-unique на `taxId`** — `(ownerId, taxId, type)` для owned і `(managers, taxId, type)` для `ownerId: null` (глобальної унікальності свідомо немає — інакше squatting чужого ЄДРПОУ); partial-index-и під адмін-черги (`publicityStatus`+`requestedAt`/`reviewedAt`, `isSystem`, `catalogVisible`+`name`); sparse `brand.pending.uploadedAt`; partial-unique claim-idempotency

### Account («реквізити»)

Файл: `apps/api/src/modules/accounts/schemas/account.schema.ts` | Zod: `packages/types/src/entities/account.ts`

- Банківський рахунок під бізнесом; `businessId` і `iban` immutable post-creation
- `bankCode` — **stored derived** з IBAN рівно один раз на create (`null` для нерозпізнаного МФО)
- `slug`/`slugLower`/`slugCustomized` — editable vanity, compound-unique `(businessId, slugLower)`
- `paymentPurposeTemplate: string | null` — per-account override призначення (`null` = успадкувати з business); потрібен системним отримувачам (ЄСВ vs військовий збір на різних рахунках)
- `catalogVisible` — гранулярна публічність окремих реквізитів
- Indexes: unique `(businessId, slugLower)`, unique `(businessId, iban)`, `(businessId, createdAt)`

### Invoice («рахунок»)

Файл: `apps/api/src/modules/invoices/schemas/invoice.schema.ts` | Zod: `packages/types/src/entities/invoice.ts`

- Nest-иться під `accountId` (immutable); `businessId` денормалізований для cascade/аналітики
- `amount: number | null` (копійки; null = signage-mode) coupled з `amountLocked`; `paymentPurpose: null` → inherit
- `payeeSnapshot` фіксує реквізити на момент create; `slugCounterScope`+`slugCounter` — partial-unique проти counter-collision
- Indexes: unique `(accountId, slugLower)`, `(accountId, createdAt -1, _id -1)`, `(businessId, createdAt -1)`, sparse `validUntil`

### BillingProfile

Файл: `apps/api/src/modules/payments/schemas/billing-profile.schema.ts` | Zod: `packages/types/src/contracts/billing-profile.ts`

- Один профіль на платника (unique `userId`). `cardToken`/`walletId` — secret monobank-поля, ніколи не серіалізуються (mapper віддає лише `BillingProfileViewSchema`)
- Два вбудовані склади (`brand` — ємність поштучних слотів, `documents` — пакет + кредитний рахунок), кожен з `attachedBusinessIds` і відкладеним зменшенням (`pending*` застосовується на межі циклу, без повернень)
- Клок-поля: `anchorDay` (день місяця першої проплати), `currentPeriodStart/End`, `nextChargeAt`, `nextRetryAt`, `dunningAttempts`, `cancelAtPeriodEnd`, `lastProviderEventAt`, `needsManualReview`
- Durable-маркери реконсиляції: `reconcileRequiredAt` + `pendingReconcileBusinessIds` (для вже відкріплених — інакше крах лишив би бізнес з `brandedAt` назавжди)
- Indexes: unique `userId`; sparse `nextChargeAt`/`nextRetryAt`/`reconcileRequiredAt`; multikey по обох `attachedBusinessIds` (гаряча перевірка «чи бізнес у активному складі»)

### Payer / Guide

- `payers/schemas/payer.schema.ts` — збережені платники користувача (сценарій бухгалтера на податкових сторінках); unique `(userId, taxId)`
- `guides/schemas/guide.schema.ts` — DB-backed SEO-гайд (переїзд з compile-time константи): `slug` global-unique (без `slugLower` — нормалізується у Zod), `status`, `pillarSlug` (null = pillar), `blocks[]`/`faq[]`, дати date-only Kyiv, `organicClicks` із Search Console. Інваріанти на service-layer: slug locked після першої публікації, delete лише чернеток

### Інші схеми

- `CreditLedgerEntry` (`payments/schemas/`) — **append-only** книга кредитних операцій; unique `idempotencyKey` (напр. `topup:<userId>:<epoch межі>`) захищає від подвійного нарахування; `(userId, createdAt -1)`
- `PaymentRecord` (`payments/schemas/`) — історія/claim-записи спроб списання; `ProcessedWebhookEvent` — unique `(provider, providerEventId)`, two-phase `pending → applied`
- `SlugReservation` (`slug-reservation/schemas/`) — ефемерна бронь бажаного slug за неплатником; **одна колекція на три рівні**: unique `userId` (одна бронь на людину) + unique `(scopeKey, slugLower)`, де `scopeKey` = `business` | `account:<bizId>` | `invoice:<accId>`; TTL-index лише прибирає рядки, семантику спливу дає фільтр `expiresAt > now` на read
- `BusinessSlugHistory` / `AccountSlugHistory` / `InvoiceSlugHistory` — старі `slugLower` після rename → 308-redirect + блокування reuse (TTL ~90 днів); slug-rent пише запис з `redirect: false` (холд без редіректу)
- `InvoiceSlugCounter` (`invoices/schemas/`) — окрема collection проти counter reuse; unique `(accountId, scope)`

## Module Dependency Map

- `AppModule` → всі модулі + global `ThrottlerGuard` (`APP_GUARD`) + `OnboardingInterceptor` (`APP_INTERCEPTOR`)
- `AuthModule` ↔ `UsersModule` (`forwardRef`, circular)
- `EmailModule`, `RedisModule` — `@Global()`; Redis exports `REDIS_CLIENT`, `RedisCounterService` (Lua-лічильники), `RedisLockService`
- `UsersModule` → `AuthModule`(fwd) + `StorageModule` (avatar) + `SlugReservationModule` (активна бронь у `getMe`) + `PayersModule` (hard-delete забирає платників); реєструє схему `BillingProfile` без Nest-залежності на Payments
- **One-way DAG**: `Users ← Businesses ← Accounts ← Invoices`
    - `BusinessesModule` → `UsersModule` + `QrModule` + `SlugReservationModule` + `StorageModule`; реєструє всі nested-схеми (cascade) + `BillingProfile` (реконсиляція); exports `BusinessesService`, `ReconciliationService`, `BrandMarkCacheService`
    - `AccountsModule` → `BusinessesModule` + `QrModule` + `SlugReservationModule`
    - `InvoicesModule` → `BusinessesModule` + `AccountsModule` + `QrModule` + `SlugReservationModule`
- `PaymentsModule` → `UsersModule` + `BusinessesModule` (реконсиляція per-business); `PAYMENT_PROVIDER` = `MonobankService` за `IPaymentProvider`; `CatalogService` — статичний типізований конфіг
- `AdminPayeesModule` → `BusinessesModule` + `AccountsModule` (лише контролери, власних сервісів немає)
- `GuidesModule` → `StorageModule` (R2-картинки блоків); `PayersModule`, `SlugReservationModule` — standalone; `AiModule` — standalone
- `LandingClaimModule` → `Businesses` + `Accounts` + `Users` + `Auth`; містить `MagicLinkVerifyController`
- `OrphanCleanupModule` → `UsersModule` + `BusinessesModule`
- Cron-сервіси: `BillingClockService` (щогодини: reconcilePending → chargeDueCycles → retryDunning), `PaymentsCleanupService` (щогодини expiry, щодня sweep реконсиляцій, кожні 10 хв stale-pending), `CleanupService` (users), `OrphanProfileCleanupService`, `BrandCleanupService`, `GuidesOrganicService`

## Key Patterns

### Створення endpoint

`@UseGuards()` + `@CurrentUser()` + Zod DTO + Service; відповідь — `{ data: ... }` envelope. Приклад: `apps/api/src/modules/payments/payments.controller.ts`

### Валідація

Zod-схема у `packages/types/src/contracts/*` → `createZodDto()` у NestJS DTO; web reuse-ить ту саму схему через `@hookform/resolvers/zod`. Discriminated-union DTO — через param-level pipe (`BusinessesController.create`).

### Guards

- `JwtActiveGuard` — основний (JWT + блокує soft-deleted); `JwtAuthGuard` — без soft-delete check (лише restore)
- `AdminGuard` — ставиться ПІСЛЯ `JwtActiveGuard`, читає `request.user.role`
- `BusinessAccessGuard` / `AccountAccessGuard` / `InvoiceAccessGuard` — slug-lookup по `slugLower` + attach `request.{business,account,invoice}`
- `UserRateLimitGuard` + `@UserRateLimit(...)` — per-user Redis fixed-window (кабінет скіпає IP-бакети)
- `HelpChatRateLimitGuard` — per-IP 24h ліміт + глобальний денний бюджет (public help)

### Rate limiting

Єдиний реєстр named-бакетів і per-user лімітів — `apps/api/src/common/http/throttle-policy.ts`. Роут з власним бакетом ОБОВ'ЯЗКОВО скіпає решту через `skipThrottlersExcept('<bucket>')`; ручні скіп-списки заборонені (дрейфують від реєстру).

### Onboarding enforcement

`OnboardingInterceptor` (APP_INTERCEPTOR) віддає `ONBOARDING_INCOMPLETE` поки профіль не заповнений; opt-out — `@SkipOnboarding()`. Файл: `common/interceptors/onboarding.interceptor.ts`.

### Auth/session lifecycle

Access JWT in-memory (web), refresh JWT у `bid_refresh` httpOnly cookie на **батьківському домені** (спільна сесія кабінету і pay-зони), Redis token families з ротацією + reuse detection. Cookie-опції — `auth/refresh-cookie.config.ts`; axios дедуплікує concurrent refresh (`apps/web/src/shared/api/client.ts`).

### Білінг — monobank, самокерований

`BillingProfileService` (`payments/billing-profile.service.ts`) — серце: per-user Redis-лок на всі мутації, claim-first `PaymentRecord` (одне списання на дію), двофазна `ProcessedWebhookEvent`-ідемпотентність, out-of-order guard `lastProviderEventAt`, ефекти + flip статусу в одній Mongo-TX. Розклад веде `BillingClockService` (cron), провайдер — тонкий виконавець (`providers/monobank/`): hosted checkout з захопленням токена, `chargeByToken`, статус рахунку, ECDSA-верифікація вебхука. Маршрутизація вебхука закодована у `orderReference` (`payments/order-reference.ts`, `fin-<kind>-<userId>-<suffix>`).

### Тарифна сітка і каталог

Сітка — compile-time константа `apps/api/src/config/billing.config.ts`, валідована `billingGridSchema`; формули (місячна сума, пропорція, підказка дешевшого пакета) — `packages/types/src/contracts/billing-grid.ts`. `CatalogService` віддає публічний зріз з прапорами `BILLING_UNIVERSE_ENABLED` (Бренд `true`, Документи `false`). «Оновлення каталогу» = деплой.

### Реконсиляція бренд-фіч і slug upsell

`ReconciliationService` (`businesses/reconciliation.service.ts`) — per-business, під глобальним reconcile-мьютексом: виставляє/знімає `brandedAt`, промотує/демоутить логотип `pending↔active`, при втраті бренду робить **slug-rent** (кастомні slug-и скидаються до авто). Ідемпотентна, батч обмежений.
Upsell: неплатник вводить бажане ім'я, бачить живу доступність (`GET …/slug-availability`), на Save зустрічає пейвол; ім'я бронюється (`SlugReservationService`) і застосовується на поверненні з білінгу — у БД до оплати нічого не пишеться. Замок — `common/billing/assert-access.ts` (`reset-slug` під нього не потрапляє).

### Кастомний брендинг (Brand)

`BrandService` + `BrandMarkCacheService` + `qr/renderers/qr-brand-mark.baker.ts`: логотип вантажиться у R2 (як avatar, без кропа), бренд-марка (логотип + опційна назва нашим шрифтом через `opentype.js`) пекеться один раз на commit у два варіанти — центр сторінкового QR і верхня смуга НБУ-QR. Знак гривні у центрі НБУ-QR недоторканний.

### QR pipeline

Pure builder у `@finly/types/src/qr/` — host-agnostic: `build00{2,3}Payload` → `encodePayloadAsBase64Url` → `buildNbuPayloadLink(version, b64, { host })`; валідує розміри, UTF-8 ліміти і NBU-charset. Рендер — `apps/api/src/modules/qr/`: `QrImageRenderer` + `QrLogoCompositor` + branded frames, оркестрація `QrService` (`renderForUrl` / `renderForNbuPayload`).

### Податкова персоналізація

`paymentPurposeTemplate` системного отримувача містить маркери `{taxId}`/`{fullName}`/`{period}` (`packages/types/src/entities/purpose-markers.ts`). Анонімний платник надсилає значення query-параметрами у `…/personalized-links` та `…/qr/personalized.png`; підстановка — `buildPersonalizedPurpose`, відповіді `no-store`. Залогінений бере значення з профілю / списку платників (`/payers`, `/payer-sources`) — у адресний рядок вони не осідають.

### Гайди й адмінка

`GuidesAdminController` (роль admin) — CRUD-конструктор блоків + R2-картинки через presigned upload; публічні `/guides/public/*` читає web з кешем під тегом. Після адмін-мутації API б'є `WEB_URL/internal/revalidate-guides` спільним секретом → `revalidateTag` (`GuidesRevalidationService`, best-effort). Органічні кліки синкає `GuidesOrganicService` через Search Console.

### Avatar pipeline (R2)

Three-step: presigned `POST /storage/avatar/upload-url` → direct PUT до R2 → `POST /storage/avatar/commit` (HeadObject verify + delete old). Client — `react-easy-crop` → canvas webp 0.85. Controller — `AvatarController` у `UsersModule`.

### Error mapping

API повертає machine-readable `code` через `AllExceptionsFilter`; web мапить через `apps/web/src/shared/api/mapApiCode.ts` (`getApiMessage(code, module?, vars?)`). Single-locale uk.

### Soft-delete lifecycle

Delete request → `accountDeletionRequestedAt` + `deletedAt` → grace period → `CleanupService` cron hard-delete (з білінг-профілем, платниками, бізнесами) + revoke tokens.

### Overlays і деструктивні підтвердження

Zustand store → `UiModal`/`UiSheet`/`UiConfirmDialog`/`UiDangerGateDialog` → реєстрація у `apps/web/src/app/overlays.tsx` (`docs/conventions/overlays.md`); кожен dialog store живе всередині свого slice (enforced ESLint). Cascade-видалення підтверджується вписуванням **кількості вкладеного** (`gates: { label, expected }[]`), а не назви; account-delete повертає `{ affectedInvoices }`.

### UI-примітиви і термінологія

Набір `Ui*` у `shared/ui/` (нативні HTML-елементи заборонені — `docs/conventions/ui-primitives.md`). Термінологія копії: «бізнес»→«отримувач», «реквізити» = банк-рахунок (Account), голий «рахунок» = виставлений документ (Invoice); ₴→грн. Код лишається `business`/`account`/`invoice`.

### FSD layer inversion

`shared/lib/authEvents` — parameterless lifecycle events: нижчий шар (`shared/api`) публікує, вищий (`entities/user`) підписується. ESLint guardrail `SHARED_MUST_NOT_IMPORT_HIGHER_LAYERS`.

### JSON transform для Mongo

`applyJsonTransform(schema)` (`common/mongoose/json-transform.ts`): `_id → id`, strip `__v`. Aggregation pipelines через transform не проходять — `_id → id` робиться явно у `$addFields + $unset`.

## API Overview

Global prefix `/api`. Global pipe `ZodValidationPipe`, global filter `AllExceptionsFilter`, named-throttler реєстр у `common/http/throttle-policy.ts`. Кабінетні контролери скіпають IP-бакети повністю (за rewrite web-контейнера всі користувачі мають один IP).

### AppController — `GET /`, `GET /health`

### AuthController (`modules/auth/auth.controller.ts`)

- `GET /auth/google` + `/auth/google/callback`; `POST /auth/check-email`, `/login/password`, `/refresh`, `/logout`
- `POST /auth/magic-link/send` — **verify живе у `MagicLinkVerifyController`** (LandingClaimModule): може нести anon-claim payload + termsVersion
- `POST /auth/password/{set,change,verify}` — `JwtActive` + `@SkipOnboarding`; `/password/reset` — через magic-link token

### UsersController + AvatarController (`modules/users/`)

- `GET/PATCH /users/me`, `POST /users/me/accept-terms`, `DELETE /users/me/slug-reservation` — `JwtActive` + `@SkipOnboarding`
- `POST /users/account/delete` + `/delete/confirm`; `POST /users/account/restore` — `JwtAuthGuard`
- Avatar: `POST /storage/avatar/upload-url`, `/commit`, `DELETE /storage/avatar`

### PaymentsController (`modules/payments/payments.controller.ts`)

- `GET /payments/catalog` — `@SkipThrottle` + `@SkipOnboarding`
- `JwtActive`: `GET /payments/profile`, `POST /payments/checkout|capacity|attach|detach|calculator`, `POST /payments/credits/buy`, `POST /payments/subscription/{cancel,resume}`, `GET /payments/payments`, `GET /payments/credits/ledger`
- `POST /payments/webhook/:provider` — `@SkipThrottle`, rawBody + header `X-Sign`; only `monobank`

### PayersController / PayerSourcesController

- `GET/POST /payers`, `PATCH/DELETE /payers/:id` — `JwtActive` + `@SkipOnboarding`
- `GET /payer-sources` — отримувачі користувача як джерело даних платника (живе у `BusinessesModule`, окремий префікс)

### Businesses / Accounts / Invoices (cabinet)

`JwtActiveGuard` + `*AccessGuard`; матрьошка `/businesses/me/:slug` → `/accounts/:accountSlug` → `/invoices/:invoiceSlug`.

- `GET /businesses/me` (з `accountsCount`/`invoicesCount`), `POST`, `GET/PATCH/DELETE /:slug` (cascade TX)
- Спільний набір на всіх трьох рівнях: `POST …/reset-slug`, `GET …/slug-availability` (`@UserRateLimit`), `POST …/slug-reservation`
- Business додатково: `POST/DELETE /:slug/publicity-request`, `PATCH /:slug/catalog-visibility`, `BrandController` — `/businesses/me/:slug/brand` (`POST upload-url|commit|preview`, `DELETE`)
- Account: `PATCH /:accountSlug/catalog-visibility`; DELETE = cascade TX → `{ affectedInvoices }`
- Invoices: `GET/POST …/invoices?page=&limit=`, `GET/PATCH/DELETE /:invoiceSlug`

### Admin (`role: admin`, `JwtActive` + `AdminGuard` + `@SkipOnboarding`)

- `/admin/payees` — CRUD системних отримувачів та їх реквізитів + `catalog-visibility`
- `/admin/publicity` — черга запитів (`GET`, `GET approved`, `POST :slug/approve|reject`)
- `/admin/guides` — список/CRUD, `images/upload-url|commit`, `sync-organic`, `reorder`, `start-draft`, `publish`, `unpublish`

### Public

- Payment-зона (`public-payment` 600/min): `/businesses/public/{sitemap.xml, catalog, :slug, :slug/qr/business.png}`, `/businesses/public/:slug/account/:accountSlug` (+ `qr/business.png`, `qr/nbu.png?host=primary|legacy`, `personalized-links`, `qr/personalized.png` — бакет `personalized-qr`), `/…/invoices/:invoiceSlug` (+2 QR). Historical-slug → 308.
- `/guides/public`, `/guides/public/sitemap/slugs`, `/guides/public/:slug` — бакет `public-content`
- `GET /qr/landing.png` (статичний, cached), `POST /qr/preview` (бакет `qr-preview` 30/min, без auth/БД)
- `POST /ai/help/chat` — anon SSE help-assistant (`help-chat` 20/min + `HelpChatRateLimitGuard`)

### ReportsController — scaffold без ендпоінтів

## Configuration & Environment

**Дві різні речі, які не можна плутати:**

1. **Секрети та адреси середовища** — у `.env`, читаються fail-fast (`apps/api/src/config/env.ts`, `apps/web/src/shared/config/env.ts`, `.env.example`). Політика: `docs/conventions/fail-fast.md`.
2. **Продукт-константи** (тарифи, ліміти, пороги) — у типізованому config-шарі, НЕ в env: `apps/api/src/config/{billing,auth,cleanup,help-chat}.config.ts`. Змінюються деплоєм, валідуються на імпорті.

**API — required env (crash if missing, no defaults)**

- Runtime: `NODE_ENV`, `API_PORT`, `TRUST_PROXY_HOPS` (Express `trust proxy`; 0 без проксі — критично для per-IP лімітів)
- Origin-и: `WEB_URL` (кабінет — з нього деривуються `AUTH_COOKIE_DOMAIN` і `GOOGLE_CALLBACK_URL`), `PAY_PUBLIC_URL` (публічна pay-зона)
- `REVALIDATE_SECRET` — спільний секрет API → web для перегенерації гайдів (мусить збігатися у обох контейнерах)
- Дані: `MONGODB_URI` (**обов'язково replica-set**), `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- Інтеграції: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; `RESEND_API_KEY`, `RESEND_FROM_EMAIL`; `MONOBANK_TOKEN` (єдиний секрет провайдера); `ANTHROPIC_API_KEY`; `GSC_SITE_URL`, `GSC_CLIENT_EMAIL`, `GSC_PRIVATE_KEY` (PEM одним рядком з `\n`)
- R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`
- **Fail-fast інваріант на старті**: хост `PAY_PUBLIC_URL` мусить лежати під доменом сесійної cookie (деривованим з `WEB_URL`) — інакше браузер мовчки відкидає `Set-Cookie` на pay-зоні

**Типізовані конфіги (не env)**

- `billing.config.ts` — `BILLING_GRID` (ціни Бренду/пакетів документів, кредити, ГБ, пороги балансу), `BILLING_DUNNING`, `BILLING_UNIVERSE_ENABLED`; валідується `billingGridSchema` на імпорті
- `auth.config.ts` — `LOGIN_LOCKOUT_THRESHOLDS`, `LOGIN_ATTEMPTS_TTL_MIN`, `MAGIC_LINK_LIMITS` + інваріант `ttlMin*60 ≥ dedupSec`
- `cleanup.config.ts` — `ACCOUNT_DELETION_GRACE_DAYS`, `ORPHAN_CLEANUP` (інваріант `first < final < deletion`), `BRAND_CLEANUP` (`pendingDays ≤ demotedDays`)
- `help-chat.config.ts` — `maxTokens`, `ipLimit`, `dailyBudget`
- Web: `shared/config/billing.ts` (`BILLING_DEMO_MODE` — демо-банер, у проді `false`), `shared/config/api.ts` (`API_BASE_URL = '/api'`)

**Web — env**

- Клієнтські `NEXT_PUBLIC_BASE_URL` / `NEXT_PUBLIC_PAY_PUBLIC_URL` **не задаються вручну**: `next.config.ts` проростає їх з `WEB_URL` / `PAY_PUBLIC_URL` (одне джерело значення). Хост для `next/image` береться з `R2_PUBLIC_URL` там само.
- `API_INTERNAL_URL` — server-side rewrite `/api/*` у контейнер API; `REVALIDATE_SECRET` — server-only.
- Fail-fast на старті: pay-хост не може дорівнювати кабінетному (інакше кабінет став би публічною зоною і вхід зник би).

**Infra** — `WEB_PORT`, `API_PORT`, `PAY_PORT` (dev-порт pay-зони; той самий web-контейнер, другий port-mapping).

## Common Commands

```
pnpm dev | build | lint | format | test                 # усі workspace через turbo

pnpm --filter api dev|build|test|test:e2e|test:cov      # API-only
pnpm --filter api email:dev                             # React Email preview @ :3100
pnpm --filter web dev|build|test                        # Web-only
pnpm --filter @finly/types build                        # rebuild shared types

pnpm --filter api migration:all                         # усі міграції по порядку
#   slug-lower · invoices-payee-snapshot · accounts-null-auto-name · nested-slug-lower
#   slug-customized · businesses-brand · guides-seed · publicity-defaults · drop-user-tax-profile
pnpm --filter api migration:drop-legacy[:force]         # дроп застарілих колекцій (окремо від all)

pnpm --filter api -- jest path/to/file.spec.ts          # один API тест
pnpm --filter web -- jest path/to/file.test.ts          # один web тест

docker compose -f docker-compose.dev.yml up --build     # dev
docker compose up --build -d                            # prod-like
```

## Testing Strategy

- API unit: `apps/api/src/**/*.spec.ts` + `apps/api/scripts/**` (міграції мають власні spec)
- API e2e: `apps/api/test/*.e2e-spec.ts` (MongoMemoryServer + provider overrides); cascade/TX-тести — `MongoMemoryReplSet`
- Web: Jest + jsdom поруч з source
- Env для тестів: `apps/api/src/test-setup.ts` (`??=`); хости там **свідомо прод-подібні** (два хости під спільним доменом), бо dev-порти не покривають cookie-домен
- CI: `.github/workflows/ci.yml` (lint → build; окремо tests). Deploy: `deploy.yml` (SSH → Docker → health checks → auto-rollback)

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

- Source of truth: `docs/conventions/README.md` (`tone`, `fail-fast`, `modular-boundaries`, `ui-primitives`, `forms`, `design-tokens`, `overlays`, `subdomains`, `responsive`)
- **Manual checks (UAT):** `docs/manual-checks/README.md` — реєстр перевірок, які unit-тести не закривають (живі банк-додатки, малі екрани, друк). Спринт мусить додавати сюди новий пункт, якщо включає такий сценарій.
- **Server playbook:** `docs/server-playbook/` — bootstrap, деплой, Caddy/Cloudflare, бекапи, runbook.

## Known Complexities

- **rawBody для webhook signature**: `NestFactory.create(AppModule, { rawBody: true })` у `main.ts` — без нього ECDSA-верифікація monobank ламається.
- **AuthModule ↔ UsersModule circular**: обидва через `forwardRef`.
- **Refresh token rotation atomic**: Redis `GETDEL` = single-use. Reuse detection → full revoke. Grace 10 s для concurrent tabs.
- **Сесійна cookie на батьківському домені**: `bid_refresh` ставиться з `Domain=` кабінетного хоста (на `localhost` — host-only, бо порт у scope не входить). Тому один вхід видно і на pay-зоні. Хибний pay-хост поза доменом → cookie мовчки відкидається; закривається fail-fast у `env.ts`.
- **Межа циклу рахується від `anchorDay`, не від попередньої межі**: інакше після короткого місяця дата застрягла б на меншому дні назавжди (31 січ → 28 лют → 28 бер).
- **Детермінований cycle-reference** `fin-cyc-<userId>-<epoch межі>`: повторний прохід клока натикається на наявний claim-запис і не списує вдруге. Неack-нутий вебхук навмисно ре-делівериться.
- **`needsManualReview`**: нерозв'язний результат списання зупиняє планувальник (`nextChargeAt = null`), але доступ зберігає; знімається автоматично при settle або руками ops.
- **Порядок локів**: завжди per-user білінг-лок → глобальний reconcile-мьютекс, зворотного немає (deadlock виключений). Per-user лока для реконсиляції НЕ досить: один бізнес може бути у складах кількох платників, а daily-sweep ходить взагалі без user-лока.
- **`brandedAt` — денормалізація, не запит**: публічний анонімний рендер і гейтинг читають прапор, а не резолвлять entitlement наживо. Тому крах між флипом і реконсиляцією закритий durable-маркерами (`reconcileRequiredAt` + `pendingReconcileBusinessIds`).
- **Slug-rent пише history з `redirect: false`**: ім'я блокується на холд, але 308 на нову адресу НЕ віддається (стара адреса просто гасне).
- **Бронь slug спливає на read, не по TTL**: TTL-thread чистить рядки з ~60 с гранулярністю; семантику дає фільтр `expiresAt > now`.
- **`packages/types` build order**: ДО `apps/api`/`apps/web`. Turborepo `dependsOn: ["^build"]` гарантує — manual build без turbo зламається.
- **`test-setup.ts` fallback env**: без нього fail-fast крашить Jest до запуску (`??=`).
- **Продукт-константи в env повертати не можна**: тарифи/ліміти/пороги живуть у `config/*.config.ts` з валідацією на імпорті; env — лише секрети й адреси середовища.
- **Single-locale uk only**: продукт українською без перемикача; email-копії інлайн, URL без locale-префіксу.
- **AI help-chat SSE errors after headers**: після `flushHeaders()` помилки йдуть SSE `ERROR`-подією. Rate-limit/budget перевіряються ДО headers — там 4xx звичайна HTTP-помилка.
- **Presigned PUT signs Content-Type only**: `Content-Length` не підписується (forbidden Fetch header); клієнт мусить надіслати exact-match `Content-Type`, інакше R2 → 403. Повторний commit того самого fileKey повертає existing URL БЕЗ видалення старого — інакше другий виклик стер би щойно збережений файл.
- **QR field separator semantics**: рядки через `\n`; trailing-empty поля ОБОВ'ЯЗКОВІ (002 — 13, 003 — 17). Без них банк-парсер відхиляє QR.
- **QR UTF-8 bytes vs chars**: норматив оперує байтами, JS `.length` — UTF-16 одиницями (кирилиця = 2 B); ліміти тримає `packages/types/src/qr/limits.ts`. Error-correction лише `M`/`Q` (норматив 003 §IV.10.4), дефолт `Q` + `logoMaxRatio ≤ 0.20`.
- **QR sharp у ts-jest**: interop bug з default-export → у `qr-logo.compositor.ts` і integration-spec `import sharp = require('sharp')`; у `storage.service.ts` — default-import (тести мокають).
- **`PayloadValidationError` mapping**: окремий `instanceof`-check у `AllExceptionsFilter`. Overflow → 400 `PAYLOAD_TOO_LARGE`, формат поля → 400 `VALIDATION_ERROR`, host-config → 500.
- **Маркери призначення матчаться широко**: regex ловить будь-яку пару дужок (`{ taxId }`, `{tax_id}`), щоб «мертвий» токен не проїхав у призначення податкового платежу літерально. Дозволені лише системним отримувачам.
- **Персоналізовані відповіді — `no-store`**: `public` дозволив би CDN/проксі зберігати РНОКПП і ПІБ конкретної людини. Звичайні pay-сторінки — `public, max-age=300` **без** `stale-while-revalidate` (сторінка revocable: видалення або slug-rent мусять гасити її у межах вікна).
- **Slug case-preserved + uniqueness on lower**: display `slug`, lookup/uniqueness на `slugLower`; reserved-перевірка лише для business-slug; canonical case → 308. **Але 1-Account redirect на корені — 307, не 308**: Chrome кешує 308 навіть з `no-cache`, і після додавання 2-го рахунку користувач застряг би.
- **Host-aware routing на одному Next.js project** (`proxy.ts`, не `middleware.ts` у Next 16): Branch A0 (корінь pay-хоста → каталог), A1–A3 (1–3 сегменти → rewrite у `host-pay/…`), B (усе інше на pay-хості → 404), C (кабінет + `/host-pay/` → 404). Host comparison case-insensitive; whitelist деривується з `PAY_PUBLIC_URL`. Server Components `host-pay/*` дублюють host-check через `headers()`.
- **Anon-flow — native `fetch` з `credentials: 'omit'`** (`publicFetchJson`/`publicPostJson`/`streamHelpChat`). Axios `apiClient` для anon заборонений: XHR не має еквівалента `omit` для same-origin, тож cabinet-credentials просочилися б.
- **`/billing-return` віддає 303, не 307**: повернення з hosted-сторінки може прийти POST-ом; 303 робить наступний перехід GET-навігацією (інакше App Router трактує як Server Action). Location відносний — за reverse-proxy `request.url` віддає внутрішній origin контейнера.
- **Guides revalidation — best-effort**: збій `POST /internal/revalidate-guides` не валить адмін-мутацію, фоновий кеш підхопить. Bearer звіряється constant-time.
- **Hard-delete з frontend-only 5 s Undo**: жодного API-виклику поки 5 с. **Timer ID живе у closure**, не в React ref — сторінка розмонтовується через optimistic redirect, і cleanup-effect убив би таймер.
- **Cascade hard-delete atomic-or-nothing**: `withTransaction` (parent + accounts + invoices + counters + history). Mongo вимагає replica-set; standalone → 500 `*_REQUIRES_REPLICA_SET`, жодного fallback на sequential.
- **Counter monotonic per `(accountId, scope)`**: окрема `InvoiceSlugCounter` (захист від reuse after delete), session-binding з invoice-TX, partial-unique + retry-on-11000 (3) у `InvoicesService.create`.
- **Lock-mask FEFF/FFFF derived from `amountLocked`**: backend-only mapping у `payload-mapper.ts` (`true → FFFF`). Frontend оперує boolean — інверсна UI-семантика «Дозволити правити суму» живе лише у формах.
- **`validUntil` у Kyiv-tz, не UTC**: `Intl.DateTimeFormat({ timeZone: 'Europe/Kyiv' })`; UTC ламав би slug `with-month` на нічних межах.
- **NBU charset refine на entity-Zod**: `.refine(isWithinNbuCharset)` поверх лімітів — інакше невалідний символ (emoji, перенос рядка) проходив save і QR-render падав з 500.
- **Public endpoint whitelist**: IBAN/taxId не витікають JSON-ом — лише через NBU-payload-link (формат, який банк читає як платіжну команду). `ibanMask` server-derived; `Public*Schema.parse()` strip-ає leak-поля.
- **Anon-claim flow**: `qrLandingDraftStore.intent` — state-machine; claim = 2 послідовні POST (Business → Account) з 3-станною відповіддю і form-recovery (success-with-state, не throw). `sendMagicLink` перезаписує trio (draft + idempotency key + termsVersion) з `KEEPTTL` (інакше `SET` скинув би TTL). Порядок у `verifyMagicLink`: auth-resolve → `stampAcceptedTerms` → claim, інакше падіння лишало б бізнес без terms-stamp.
