# NeatSlip

> **Product vision (neatslip.com):** SaaS для українських ФОП та їх бухгалтерів. Генерація платіжних QR-кодів і посилань за стандартом НБУ — клієнт сканує QR і платить без ручного введення реквізитів. У планах: зберігання документів з AI-тегуванням для швидкого пошуку.

## Поточний стан

QR/НБУ-флоу та document storage ще **не реалізовані**. Цей репозиторій містить тех-фундамент: monorepo-monolith на Next.js 16 + NestJS 11 з auth, Stripe payments, AI chat (Anthropic), executions ledger, R2 avatar storage, i18n, theming та модульною архітектурою. Структура та сервіси нижче описують саме цей фундамент.

---

## Структура проєкту

```
neatslip/
├── apps/
│   ├── web/                  # Frontend (Next.js 16, React 19)
│   │   └── src/
│   │       ├── app/[locale]/
│   │       │   ├── auth/             # Signin, callback, verify, reset-password
│   │       │   ├── (protected)/      # Dashboard, profile, billing, ai-chat
│   │       │   ├── privacy/          # Privacy policy
│   │       │   ├── terms/            # Terms of service
│   │       │   └── page.tsx          # Root landing
│   │       ├── features/             # Auth, billing, profile, change-lang, change-theme
│   │       ├── entities/             # User, navigation, brand
│   │       ├── widgets/              # Header
│   │       └── shared/               # API client, UI, config, styles, i18n
│   └── api/                  # Backend (NestJS 11)
│       └── src/
│           ├── modules/
│           │   ├── auth/             # Google OAuth, Magic Link, Password, JWT
│           │   ├── users/            # CRUD, profile, soft-delete, executions ledger
│           │   ├── payments/         # Stripe subscriptions + one-off execution packs
│           │   ├── ai/               # Streaming chat (Anthropic SSE)
│           │   ├── storage/          # Cloudflare R2 avatar pipeline
│           │   ├── reports/          # Skeleton
│           │   └── email/            # Resend transactional emails
│           └── common/               # Guards, filters, decorators, Redis provider
├── packages/
│   └── types/                # @neatslip/types — Zod-схеми, типи, контракти
├── docs/                     # Conventions
├── docker-compose.yml        # Production (api + web)
├── docker-compose.dev.yml    # Development (mongo + redis + api + web)
├── turbo.json                # Build pipeline
└── pnpm-workspace.yaml       # Workspaces: apps/*, packages/*
```

---

## Технології

| Шар        | Технологія                                                                      |
| ---------- | ------------------------------------------------------------------------------- |
| Monorepo   | Turborepo + pnpm workspaces                                                    |
| Frontend   | Next.js 16 (App Router), React 19, Zustand, TailwindCSS 4, next-intl, next-themes |
| Backend    | NestJS 11, Mongoose (MongoDB), Passport (JWT + Google OAuth), ioredis (Redis)   |
| Payments   | Stripe (subscriptions + one-off credit packs, webhook idempotency)              |
| Shared     | Zod 4 (single source of truth), TypeScript 5.9 (strict)                        |
| Email      | Resend                                                                          |
| Тести      | Jest 30, Supertest, MongoMemoryServer                                           |

---

## Що реалізовано

- **Auth**: Google OAuth, Magic Link, Password login, brute force protection, token rotation з reuse detection
- **Users**: Profile management, preferred language, account soft-delete з 30-day grace period, scheduled cleanup
- **Payments**: Stripe subscriptions, one-off credit packs, two-phase webhook idempotency, billing portal
- **i18n**: uk/en, server + client, email templates двома мовами
- **Theming**: Light / Dark / System (next-themes)
- **UI**: Feature-Sliced Design, Headless UI, Radix, polymorphic components

---

## Швидкий старт

### Вимоги

- **Docker** + **Docker Compose**

### 1. Створи файл `.env` у корені

```env
# Обов'язкові
NODE_ENV=development
WEB_PORT=3000
API_PORT=4000

# MongoDB
MONGODB_URI=mongodb://mongo:27017

# JWT
JWT_ACCESS_SECRET=your-access-secret
JWT_REFRESH_SECRET=your-refresh-secret

# Redis
REDIS_URL=redis://redis:6379

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/google/callback

# Resend
RESEND_API_KEY=your-resend-api-key

# Stripe
STRIPE_SECRET_KEY=your-stripe-secret-key
STRIPE_WEBHOOK_SECRET=your-stripe-webhook-secret
STRIPE_PRICE_ID_SUBSCRIPTION=your-stripe-price-id

# Stripe credit packs (потрібні при PAYMENTS_ONE_OFF_ENABLED=true)
# STRIPE_PRICE_ID_CREDITS_5=price_xxx
# STRIPE_PRICE_ID_CREDITS_10=price_xxx
# STRIPE_PRICE_ID_CREDITS_20=price_xxx

# Web
NEXT_PUBLIC_BASE_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000/api
```

Повний список змінних: [apps/api/src/config/env.ts](apps/api/src/config/env.ts), [apps/web/src/shared/config/env.ts](apps/web/src/shared/config/env.ts).

### 2. Запуск для розробки

```bash
docker compose -f docker-compose.dev.yml up --build
```

| Сервіс   | URL / Порт             |
| -------- | ---------------------- |
| Frontend | http://localhost:3000   |
| Backend  | http://localhost:4000   |
| MongoDB  | localhost:27017         |
| Redis    | localhost:6379          |

Зупинити:

```bash
docker compose -f docker-compose.dev.yml down
```

### 3. Запуск для production

1. У `.env` вкажи реальний MongoDB Atlas URI та інші production credentials.
2. Запусти:

```bash
docker compose up --build -d
```

---

## Скрипти

| Команда                                   | Опис                        |
| ----------------------------------------- | --------------------------- |
| `pnpm dev`                                | Dev-сервери через Turborepo |
| `pnpm build`                              | Build all                   |
| `pnpm lint`                               | Lint all                    |
| `pnpm format`                             | Prettier format             |
| `pnpm test`                               | Test all via Turborepo      |
| `pnpm --filter api test`                  | API unit тести              |
| `pnpm --filter api test:e2e`              | API E2E тести               |
| `pnpm --filter api test:cov`              | API coverage                |
| `pnpm --filter web test`                  | Web unit тести              |
| `pnpm --filter @neatslip/types build`    | Build shared types          |

---

## Документація

- [Conventions](docs/conventions/README.md) — правила та конвенції для розробки
