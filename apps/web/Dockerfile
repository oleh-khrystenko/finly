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
# Приймаємо build-арги від compose. NEXT_PUBLIC_* МУСЯТЬ бути доступні
# під час `next build`, бо Next.js inline-ить їх у client bundle build-time;
# fail-fast loader (`apps/web/src/shared/config/env.ts`) crash-ить на
# undefined значенні.
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_PAYMENTS_SUBSCRIPTION_ENABLED
ARG NEXT_PUBLIC_PAYMENTS_ONE_OFF_ENABLED
ARG NEXT_PUBLIC_STORAGE_HOSTNAME
ARG NEXT_PUBLIC_PAY_PUBLIC_URL
ARG API_INTERNAL_URL
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_PAYMENTS_SUBSCRIPTION_ENABLED=$NEXT_PUBLIC_PAYMENTS_SUBSCRIPTION_ENABLED
ENV NEXT_PUBLIC_PAYMENTS_ONE_OFF_ENABLED=$NEXT_PUBLIC_PAYMENTS_ONE_OFF_ENABLED
ENV NEXT_PUBLIC_STORAGE_HOSTNAME=$NEXT_PUBLIC_STORAGE_HOSTNAME
ENV NEXT_PUBLIC_PAY_PUBLIC_URL=$NEXT_PUBLIC_PAY_PUBLIC_URL
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
