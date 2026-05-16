# 05 — App deploy

Goal: clone the application repo to `/opt/<PROJECT>`, drop a populated `.env`, bring the stack up, and verify the app is reachable on `127.0.0.1:3000` (Caddy will be wired in step 06).

This guide assumes a Compose v2 stack with three services (`web`, `api`, `redis`) similar to cyanship.com, but the structure generalises to any number of services.

## 1. Repo clone

If the repo is private, set up a deploy key:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "<PROJECT>-deploy@<DOMAIN>"
cat ~/.ssh/github_deploy.pub          # add this to the GitHub deploy keys (read-only)
```

Then:

```bash
sudo install -d -o <USER> -g <USER> /opt/<PROJECT>
cd /opt/<PROJECT>
GIT_SSH_COMMAND="ssh -i ~/.ssh/github_deploy -o IdentitiesOnly=yes" \
    git clone <GITHUB_REPO> .
```

For public repos `git clone https://github.com/...` is fine.

## 2. `.env`

Never check secrets into the repo. The repo should ship `.env.example` with the variable names. Copy it and fill in real values:

```bash
cp .env.example .env
chmod 600 .env
vim .env       # paste real keys
```

Mandatory hygiene:

```bash
ls -la .env       # -rw------- 1 <USER> <USER>
grep -c -E '^[A-Z_]+=' .env   # number of vars defined; compare to .env.example
```

## 3. Compose file naming

Compose v2 prefers `compose.yaml` over `docker-compose.yml`. Resolution order:

1. `compose.yaml`
2. `compose.yml`
3. `docker-compose.yaml`
4. `docker-compose.yml`

Use `compose.yaml`. New repos should ship that name. If you inherit a `docker-compose.yml`, rename when convenient — `docker compose` will still find it either way.

## 4. Healthchecks

Without healthchecks `restart: unless-stopped` only catches *crashes*, not *hangs*. Add per-service blocks. Example for the cyanship.com stack:

```yaml
services:
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 128mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    networks:
      - internal
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s
    restart: unless-stopped

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    env_file: .env
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - internal
    healthcheck:
      test: ["CMD-SHELL", "wget --spider -q http://127.0.0.1:${API_PORT}/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
    restart: unless-stopped

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    env_file: .env
    depends_on:
      api:
        condition: service_healthy
    ports:
      - "127.0.0.1:3000:3000"
    networks:
      - internal
    healthcheck:
      test: ["CMD-SHELL", "wget --spider -q http://$$HOSTNAME:${WEB_PORT}/"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 60s
    restart: unless-stopped

networks:
  internal:

volumes:
  redis_data:
```

Notes:
- `127.0.0.1:3000:3000` — the only port published on the host. Caddy proxies to this.
- `api` and `redis` stay on the `internal` network, never reachable from outside.
- `depends_on … condition: service_healthy` makes `compose up` wait for upstream health.
- The double `$$HOSTNAME` escapes the `$` so compose passes the literal `$HOSTNAME` into the container shell.

## 5. Bring it up

```bash
cd /opt/<PROJECT>
docker compose pull          # if you use prebuilt images; harmless to run
docker compose up -d --build
docker compose ps
```

Wait for `STATUS` of every container to read `Up X (healthy)`. First boot may take 1–3 min while a Next.js build runs.

If `web` shows `unhealthy`, check logs:

```bash
docker compose logs --tail=200 web
```

## 6. Verify locally

```bash
curl -sS -o /dev/null -w "%{http_code} ttfb=%{time_starttransfer}s\n" http://127.0.0.1:3000/
```

Expected `200 ttfb=...`. The app is now ready for Caddy. Move to `06-caddy-cloudflare.md`.

## Updating later

Standard deploy from main:

```bash
cd /opt/<PROJECT>
git pull
docker compose up -d --build
docker compose ps
```

Always recheck `docker compose ps` after — `unless-stopped` will keep restarting a broken container forever, but it'll be marked `(unhealthy)`.

Rollback:

```bash
cd /opt/<PROJECT>
git log --oneline -5
git reset --hard <previous-sha>
docker compose up -d --build
```

If the issue is a bad image rather than bad code, also `docker compose pull` after the reset.
