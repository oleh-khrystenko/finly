# Finly

> **Product vision (finly.com.ua):** SaaS для українських ФОП та їх бухгалтерів. Генерація платіжних QR-кодів і посилань за стандартом НБУ — клієнт сканує QR і платить без ручного введення реквізитів. У планах: зберігання документів з AI-тегуванням для швидкого пошуку.

## Поточний стан

QR/НБУ-флоу та document storage ще **не реалізовані**. Цей репозиторій містить тех-фундамент: monorepo-monolith на Next.js 16 + NestJS 11 з auth, Stripe payments, AI chat (Anthropic), executions ledger, R2 avatar storage, i18n, theming та модульною архітектурою. Структура та сервіси нижче описують саме цей фундамент.

---

## Структура проєкту

```
finly/
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
│   └── types/                # @finly/types — Zod-схеми, типи, контракти
├── docs/                     # Conventions
├── docker-compose.yml        # Production (api + web)
├── docker-compose.dev.yml    # Development (redis + api + web; Mongo — external)
├── turbo.json                # Build pipeline
└── pnpm-workspace.yaml       # Workspaces: apps/*, packages/*
```

---

## Технології

| Шар      | Технологія                                                                        |
| -------- | --------------------------------------------------------------------------------- |
| Monorepo | Turborepo + pnpm workspaces                                                       |
| Frontend | Next.js 16 (App Router), React 19, Zustand, TailwindCSS 4, next-intl, next-themes |
| Backend  | NestJS 11, Mongoose (MongoDB), Passport (JWT + Google OAuth), ioredis (Redis)     |
| Payments | Stripe (subscriptions + one-off credit packs, webhook idempotency)                |
| Shared   | Zod 4 (single source of truth), TypeScript 5.9 (strict)                           |
| Email    | Resend                                                                            |
| Тести    | Jest 30, Supertest, MongoMemoryServer                                             |

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
- **MongoDB replica-set** — обов'язково (cascade-delete у Sprint 4 використовує
  `session.withTransaction`; standalone mongod не підтримує транзакції).
  Налаштування — секція [Mongo replica-set для local dev](#mongo-replica-set-для-local-dev)
  нижче.

### 1. Створи файл `.env` у корені

```env
# Обов'язкові
NODE_ENV=development
WEB_PORT=3000
API_PORT=4000

# MongoDB — MUST бути replica-set (cascade-delete у Sprint 4 використовує
# `session.withTransaction`). `docker-compose.dev.yml` Mongo не запускає —
# обери один з трьох варіантів у секції "Mongo replica-set для local dev"
# нижче. Найпростіший — Atlas dev cluster:
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/finly?appName=finly

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

### 2. Додай запис у `/etc/hosts` для public-домену

Public payment-page (`pay.finly.com.ua` у prod) у dev слухає `pay.finly.local:3000` — той самий Next.js container, що cabinet, але інший host-header (host-aware routing у `apps/web/src/middleware.ts`, whitelist у `apps/web/src/shared/config/publicHosts.ts`). Без локального DNS-запису браузер падає з `DNS_PROBE_FINISHED_NXDOMAIN` ще до того, як Next.js отримає запит.

```bash
echo '127.0.0.1 pay.finly.local' | sudo tee -a /etc/hosts
```

Після цього `http://pay.finly.local:3000/{slug}` резолвиться у localhost, middleware ідентифікує host як public і робить rewrite на internal `/host-pay/{slug}`.

> **Prod.** Запис у `/etc/hosts` не потрібен — `pay.finly.com.ua` має мати DNS-A/CNAME-record на той самий сервер, що `finly.com.ua`, і reverse-proxy (nginx/Caddy) проксує обидва host-header-и на один Next.js container.

### 3. Запуск для розробки

```bash
docker compose -f docker-compose.dev.yml up --build
```

| Сервіс   | URL / Порт                               |
| -------- | ---------------------------------------- |
| Frontend | http://localhost:3000                    |
| Backend  | http://localhost:4000                    |
| MongoDB  | external (Atlas / Docker / local mongod) |
| Redis    | localhost:6379                           |

Зупинити:

```bash
docker compose -f docker-compose.dev.yml down
```

### 4. Запуск для production

1. У `.env` вкажи реальний MongoDB Atlas URI та інші production credentials.
2. Запусти:

```bash
docker compose up --build -d
```

---

## Скрипти

| Команда                            | Опис                        |
| ---------------------------------- | --------------------------- |
| `pnpm dev`                         | Dev-сервери через Turborepo |
| `pnpm build`                       | Build all                   |
| `pnpm lint`                        | Lint all                    |
| `pnpm format`                      | Prettier format             |
| `pnpm test`                        | Test all via Turborepo      |
| `pnpm --filter api test`           | API unit тести              |
| `pnpm --filter api test:e2e`       | API E2E тести               |
| `pnpm --filter api test:cov`       | API coverage                |
| `pnpm --filter web test`           | Web unit тести              |
| `pnpm --filter @finly/types build` | Build shared types          |

---

## Mongo replica-set для local dev

Sprint 4 cascade-delete виконується у `session.withTransaction` — Mongo дозволяє транзакції тільки на replica-set. **`docker-compose.dev.yml` Mongo не запускає** (production-parity з Atlas; кожен developer обирає один із трьох варіантів нижче).

### Два workflow-режими запуску API

Перш ніж обирати варіант — визнач, як запускаєш API:

- **Режим H** — `pnpm --filter api dev` на host-machine без Docker. API бачить host-network безпосередньо.
- **Режим C** — `docker compose -f docker-compose.dev.yml up`. API ізольований у compose-network: `localhost` всередині контейнера = сам контейнер, **не** host-machine.

Connection-string у `.env` залежить від режиму. Copy-paste `mongodb://localhost:...` з варіанту (б)/(в) у Режим C дасть `MongoServerSelectionError`.

### Варіанти

#### (а) Atlas dev cluster — рекомендований

Replica-set за замовчуванням, public DNS-host у URI (`mongodb+srv://...`) — однаково резолвиться з host-machine і з compose-контейнера. **Єдиний варіант, що працює одразу для обох Режимів H і C** без host-networking-tax.

```env
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/finly?appName=finly
```

#### (б) Standalone Docker container на host-machine з replica-set

```bash
docker run -d --name finly-mongo-dev -p 27017:27017 \
    --add-host host.docker.internal:host-gateway \
    mongo:7 --replSet rs0 --bind_ip_all

# Чекаємо, поки контейнер відповість на ping (idempotent loop):
until docker exec finly-mongo-dev mongosh --quiet --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1; do sleep 1; done

# Init replica-set — обери ОДИН з двох варіантів залежно від workflow-режиму.
# AlreadyInitialized безпечно ігнорувати на повторі.

# --- Режим H (API на host) ---
docker exec finly-mongo-dev mongosh --quiet --eval \
    'rs.initiate({_id:"rs0", members:[{_id:0, host:"localhost:27017"}]})'

# --- Режим C (API у compose) ---
docker exec finly-mongo-dev mongosh --quiet --eval \
    'rs.initiate({_id:"rs0", members:[{_id:0, host:"host.docker.internal:27017"}]})'
```

`MONGODB_URI` у `.env`:

```env
# Режим H:
MONGODB_URI=mongodb://localhost:27017/finly_dev?replicaSet=rs0
# Режим C:
MONGODB_URI=mongodb://host.docker.internal:27017/finly_dev?replicaSet=rs0
```

**Linux-specific.** `host.docker.internal` НЕ резолвиться ні в API-контейнері, ні в Mongo-контейнері без явного `host-gateway` alias-у. Тому:

- `--add-host host.docker.internal:host-gateway` у `docker run` для Mongo (вище) — щоб heartbeat replica-set self-discovery не деградував.
- `extra_hosts: ["host.docker.internal:host-gateway"]` у `api`-блоці `docker-compose.dev.yml` — уже додано Sprint 4 §4.0.

На macOS/Windows обидва alias-и built-in у Docker Desktop — згадані команди безпечні no-op-и.

**`directConnection`-параметр НЕ додавай.** Node driver default `directConnection=false` активує SDAM і replica-set discovery через `replicaSet=rs0` query-param — це саме те, що потрібно для transactions. `directConnection=true` bypass-ить SDAM, і `withTransaction` падає з `IllegalOperation`.

#### (в) Local mongod на host-machine з replica-set — тільки для Режим H

```bash
mongod --replSet rs0 --bind_ip 127.0.0.1
mongosh --eval 'rs.initiate({_id:"rs0", members:[{_id:0, host:"localhost:27017"}]})'
```

```env
MONGODB_URI=mongodb://localhost:27017/finly_dev?replicaSet=rs0
```

**Не рекомендується для Режим C на Linux** — local mongod heartbeat не зможе резолвити `host.docker.internal` без manual `/etc/hosts` edit. Якщо потрібен Режим C без Atlas — використовуй (б), не (в).

### Перевірка, що replica-set ОК

Перевірка робиться у два кроки: спершу — health самого replica-set-у (виконується завжди з Mongo-контейнера або host-mongosh; **не з api-контейнера** — `node:20-alpine` mongosh не містить), потім — reach з api-контейнера на Mongo-host через TCP (тільки для Режим C на Linux, де alias-резолвинг буває крихким).

**Крок 1 — replica-set health.**

```bash
# Варіант (б) Docker Mongo — з самого Mongo-контейнера, mongosh там присутній:
docker exec finly-mongo-dev mongosh --quiet \
    --eval "rs.status().ok"   # → 1

# Варіанти (а) Atlas / (в) local mongod — з host-machine (потрібен mongosh локально):
mongosh "$MONGODB_URI" --eval "rs.status().ok"   # → 1
```

**Крок 2 — reach з api-контейнера (тільки Режим C).** api-контейнер на `node:20-alpine` без `mongosh`, тому перевіряємо TCP-доступність до Mongo-хоста через вбудований Node:

```bash
docker compose -f docker-compose.dev.yml exec api node -e \
    "require('net').connect(27017,'host.docker.internal').on('connect',()=>{console.log('ok');process.exit(0)}).on('error',e=>{console.error(e.message);process.exit(1)})"
# → ok
```

Якщо `rs.status().ok` повертає `0` або Крок 2 timeout-ить — на Linux перевір, чи `--add-host` був у docker-run для Mongo (для самого heartbeat) і чи `extra_hosts` присутні у `api`-блоці compose (для reach з api → Mongo); на macOS/Windows — рестартни Docker Desktop (`host.docker.internal` іноді stale після сну).

### Що буде, якщо replica-set не налаштований

API стартує нормально (connection-string не валідується на topology). Cascade-delete бізнесу падає з 500 `CASCADE_DELETE_REQUIRES_REPLICA_SET`; user бачить нейтральне "Не вдалося видалити бізнес. Зверніться в підтримку"; справжню причину видно лише у server-логах. Інші CRUD-операції працюють.

---

## Документація

- [Conventions](docs/conventions/README.md) — правила та конвенції для розробки
