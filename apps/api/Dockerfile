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
