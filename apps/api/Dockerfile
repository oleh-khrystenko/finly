# syntax=docker/dockerfile:1.4

# ---------- base ----------
FROM node:20-alpine AS base
WORKDIR /app
ENV CI=true
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---------- deps ----------
FROM base AS deps
# Кеш-ефективно копіюємо маніфести
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY turbo.json tsconfig.json ./
COPY packages/types/package.json ./packages/types/package.json
COPY apps/api/package.json ./apps/api/package.json
# Встановлюємо тільки залежності, потрібні API та його workspace-пакетам
RUN --mount=type=cache,target=/root/.pnpm-store \
    pnpm install --frozen-lockfile \
    --filter ./apps/api... \
    --filter ./packages/types...

# ---------- build ----------
FROM deps AS build
COPY . .
# Збираємо types (shared package) перед API
RUN pnpm --filter ./packages/types build
# Збираємо тільки API
RUN pnpm --filter ./apps/api build
# Формуємо мінімальний деплой-пакет з прод-залежностями
RUN pnpm deploy --filter ./apps/api --prod --legacy /out

# ---------- migrations ----------
# One-shot контейнер для DB-міграцій. Extends `build` stage, де ts-node, dev
# deps і scripts/ ще присутні (на відміну від обрізаного через
# `pnpm deploy --prod` runtime). Запускається перед `docker compose up -d api`
# через окремий compose-profile (`migrations`); failure блокує deploy.
#
# **CMD = `migration:all`-orchestrator** (Sprint 4 review fix). Раніше CMD
# хардкоджено на одну міграцію (slug-lower); кожна нова міграція потребувала
# update Dockerfile + deploy.yml + risk забути одне з двох. Тепер
# `migration:all` chain-ить усі міграції chronologically (ідемпотентні —
# re-run cheap no-op). Додавання нової міграції зводиться до:
#   1) новий `*.ts` script + `*.spec.ts`
#   2) npm-script `migration:<slug>` + додаток у `migration:all` chain
#   3) запис у `scripts/migrations/README.md` registry
# Дeploy.yml не міняється.
FROM build AS migrations
WORKDIR /app/apps/api
ENV NODE_ENV=production
CMD ["pnpm", "run", "migration:all"]

# ---------- runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
RUN corepack enable

# Копіюємо вже “обрізаний” пакет
COPY --from=build /out ./

# Якщо dist потрапив у deploy — готово.
# Якщо deploy не переніс dist, додай окреме копіювання:
# COPY --from=build /app/apps/api/dist ./apps/api/dist

EXPOSE 4000
CMD ["node", "dist/main.js"]
