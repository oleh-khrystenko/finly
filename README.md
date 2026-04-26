# CyanShip

Production-ready SaaS-бойлерплейт та одночасно живий лендінг агенції — все, що потрібно для швидкого запуску web-додатка: auth, payments, i18n, theming та модульна архітектура з коробки.

При старті нового проекту робиться форк репозиторію, видаляється модуль agency, і розробка клієнтського продукту починається поверх готового ядра. Детальніше: [docs/vision/product.md](docs/vision/product.md).

---

## Архітектура

Turborepo-монорепозиторій з жорстким розділенням на два шари:

- **Core** — авторизація, користувачі, платежі, shared UI, валідація, i18n. Стабільне ядро, що повторно використовується в кожному проекті.
- **Agency** — бізнес-логіка агенції (лендінг, лід-магніти). Ізольований модуль, який видаляється за 15 хвилин при форку.

Одностороння залежність: Agency -> Core, ніколи навпаки (enforced ESLint).

---

## Структура проєкту

```
cyanship/
├── apps/
│   ├── web/                  # Frontend (Next.js 16, React 19)
│   │   └── src/
│   │       ├── app/[locale]/
│   │       │   ├── auth/             # Signin, callback, verify
│   │       │   ├── (protected)/      # Profile, billing
│   │       │   └── (agency)/         # Agency pages (scaffold)
│   │       ├── features/             # Auth, profile, change-lang, change-theme
│   │       ├── entities/             # Brand, agency (scaffold)
│   │       ├── widgets/              # Header
│   │       └── shared/               # API client, UI, config, styles, i18n
│   └── api/                  # Backend (NestJS 11)
│       └── src/
│           ├── modules/
│           │   ├── auth/             # Google OAuth, Magic Link, Password, JWT
│           │   ├── users/            # CRUD, profile, soft-delete, credits
│           │   ├── payments/         # Stripe subscriptions + one-off credit packs
│           │   ├── agency/           # Agency module (scaffold)
│           │   ├── reports/          # Skeleton
│           │   └── storage/          # Skeleton
│           └── common/               # Guards, filters, decorators, Redis provider
├── packages/
│   └── types/                # @cyanship/types — Zod-схеми, типи, контракти
│       └── src/
│           ├── index.ts              # Core exports
│           └── agency.ts             # Agency exports (окремий entry point)
├── docs/                     # Vision, planning, testing, conventions
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
| `pnpm --filter @cyanship/types build`    | Build shared types          |

---

## Документація

- [Vision & Product](docs/vision/product.md) — опис проекту, бізнес-модель, позиціонування
- [Conventions](docs/conventions/README.md) — правила та конвенції для розробки
- [Architecture](docs/architecture/README.md) — опис реалізованих підсистем (auth, payments)
- [Testing](docs/testing/) — тестові плани (auth, payments)
