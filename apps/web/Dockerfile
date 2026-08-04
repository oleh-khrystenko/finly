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
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY turbo.json tsconfig.json ./
COPY packages/types/package.json ./packages/types/package.json
COPY apps/web/package.json ./apps/web/package.json
# Встановлюємо тільки залежності, потрібні Next-додатку та спільним пакетам
RUN --mount=type=cache,target=/root/.pnpm-store \
    pnpm install --frozen-lockfile \
    --filter ./apps/web... \
    --filter ./packages/types...


# ---------- build ----------
FROM deps AS build
# Приймаємо build-арги від compose. Origin-и МУСЯТЬ бути доступні під час
# `next build`: `next.config.ts` проростає їх у `NEXT_PUBLIC_*`, які Next
# inline-ить у client bundle build-time, а fail-fast loader
# (`apps/web/src/shared/config/env.ts`) крашить на undefined значенні.
ARG WEB_URL
ARG PAY_PUBLIC_URL
ARG R2_PUBLIC_URL
ARG API_INTERNAL_URL
ENV WEB_URL=$WEB_URL
ENV PAY_PUBLIC_URL=$PAY_PUBLIC_URL
ENV R2_PUBLIC_URL=$R2_PUBLIC_URL
ENV API_INTERNAL_URL=$API_INTERNAL_URL

COPY . .
# Збираємо types (shared package) перед web
RUN pnpm --filter ./packages/types build
# Вимикаємо телеметрію і будуємо лише web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter ./apps/web build


# ---------- runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN corepack enable


COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static


EXPOSE 3000
CMD ["node", "apps/web/server.js"]
