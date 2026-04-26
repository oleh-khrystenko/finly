# CyanShip
> Modern monorepo SaaS boilerplate з Next.js 16, NestJS 11 та Feature-Sliced Design.

## Tech Stack
- **Frameworks:** Next.js 16 (App Router), NestJS 11
- **Database:** MongoDB (Mongoose), Redis (ioredis)
- **Auth:** Passport.js (JWT + Google OAuth), Token Rotation
- **Payments:** Stripe (Subscriptions + One-off packs)
- **Styling:** TailwindCSS 4, Radix UI
- **State/i18n:** Zustand, next-intl
- **Communication:** Axios, Resend (Email)
- **Testing:** Jest, Supertest

## Architecture Overview
Проєкт побудований як Modular Monolith з жорстким розділенням на **Core** (стабільне ядро) та **Agency** (ізольований бізнес-модуль). Frontend реалізовано за методологією **Feature-Sliced Design (FSD)**. Backend використовує модульну структуру NestJS. Всі типи та Zod-схеми винесені в спільний пакет `@cyanship/types`.

## Project Structure
- `apps/api/` # Backend (NestJS 11)
  - `src/modules/` # Доменні модулі (auth, users, payments)
  - `src/common/` # Глобальні Guards, Filters, Decorators
- `apps/web/` # Frontend (Next.js 16)
  - `src/features/` # Бізнес-фічі (auth, profile)
  - `src/shared/ui/` # Атомарні UI компоненти
- `packages/types/` # Single source of truth для типів
  - `src/contracts/` # API контракти та Zod схеми
- `docs/` # Архітектурна та технічна документація

## Domain Model & Schema
- **User** — `apps/api/src/modules/users/schemas/user.schema.ts`. Ключова сутність: профілі, баланс кредитів, Stripe billing, soft-delete (30 днів).
- **Audit Logs** — (в планах) для відстеження критичних дій.

## Module Dependency Map
`Agency` → `Core` (Однонаправлена залежність)
`apps/web` → `@cyanship/types`
`apps/api` → `@cyanship/types`

## Key Patterns (CodeDNA)
- **Створення Endpoint:** Controller + DTO + Guard. Приклад: `apps/api/src/modules/users/users.controller.ts`.
- **Global Error Handling:** Конвертація в уніфікований формат. Файл: `apps/api/src/common/filters/all-exceptions.filter.ts`.
- **Auth Guarding:** `JwtActiveGuard` для перевірки активності токена. Файл: `apps/api/src/common/guards/jwt-active.guard.ts`.
- **Fail-fast Config:** Валідація env при старті. Файл: `apps/api/src/config/env.ts`.

## API Surface
- `POST /auth/login/password` — Login за паролем
- `POST /auth/magic-link/send` — Відправка Magic Link
- `GET /users/me` [JwtActiveGuard] — Профіль поточного користувача
- `PATCH /users/me` [JwtActiveGuard] — Оновлення профілю
- `POST /payments/checkout-session` [JwtActiveGuard] — Створення сесії оплати
- `POST /payments/webhook/stripe` — Обробка вебхуків Stripe (idempotent)

## Environment & Config
Критичні змінні: `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `STRIPE_SECRET_KEY`, `RESEND_API_KEY`.
**Fail-fast policy:** Додаток не завантажується, якщо хоча б одна обов'язкова змінна відсутня в `env.ts`.

## Dev Workflow
- `pnpm dev` — Запуск усіх сервісів (Turborepo)
- `pnpm build` — Build всього проєкту
- `pnpm lint` — Перевірка коду ESLint
- `pnpm test` — Запуск Jest тестів
- `docker compose -f docker-compose.dev.yml up` — Інфраструктура (Mongo + Redis)

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

## Known Complexities & Debt
- **Stripe Webhooks:** Потребують `rawBody` для перевірки підпису. Реалізовано в `PaymentsController` через `RawBodyRequest`.
- **Token Rotation:** Refresh token rotation з детекцією повторного використання для захисту від сесійного крадіжки.
- **I18n Sync:** Складна логіка синхронізації мови між Frontend middleware та Backend `preferredLang`.
- **Soft Delete:** Вимагає перевірки `deletedAt` у всіх критичних операціях через `JwtActiveGuard`.
