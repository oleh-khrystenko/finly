# 00 — Production preflight checklist

Перед тим, як ти сядеш виконувати playbook `01..08` на VPS, збери ВСЕ нижче в один документ (password-manager / notes). Кожен пункт каже, **де взяти значення** і **куди воно піде**. Якщо хочаб одне поле «TODO», `05-app-deploy.md` зламається на `getEnvVar(...) throw`.

Замінники з кореневого `README.md`:

| Placeholder | Значення для Finly |
|---|---|
| `<DOMAIN>` | `finly.com.ua` |
| `<PROJECT>` | `finly` |
| `<USER>` | `ubuntu` (рекомендований non-root sudo user — налаштовується у §02) |

## 0. OVH VPS purchase walkthrough

Робиться **до** початку playbook-у `01..08`. Очікувано: ~10 хвилин у OVH UI + ~5 хвилин на provisioning.

1. Створи акаунт на **[ovhcloud.com](https://www.ovhcloud.com)** (якщо ще немає). Білінг — карта або bank transfer.
2. У навігації: **Hosting → VPS → Order VPS** (або прямо [ovhcloud.com/uk/vps/](https://www.ovhcloud.com/uk/vps/)).
3. **Plan:** для Finly — **VPS-2** (раніше називався `vps-2024-le-2`):
   - 2 vCPU, **8 GB RAM**, 80 GB NVMe SSD, 500 Mbps unmetered
   - Це мінімум: Next.js + NestJS build процеси разом їдять >4 GB RAM peak. VPS-1 (4 GB) ризикує OOM під час `compose up --build`.
4. **Datacenter:** для UA users — **Warsaw (Poland)** або **Frankfurt (Germany)**. Strasbourg/Gravelines теж працюють, але латентність +20-30ms.
5. **OS:** Ubuntu **24.04 LTS Server** (no GUI). Не Debian, не Ubuntu 22.04 — playbook валідовано конкретно на 24.04.
6. **SSH key:** на цьому кроці OVH дає upload-нути public key. Згенеруй локально на ноутбуці нову пару спеціально для VPS:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/finly_vps -N "" -C "finly-prod-root@$(hostname)"
   cat ~/.ssh/finly_vps.pub   # це upload-уй в OVH UI
   ```
   Private key (`~/.ssh/finly_vps`) залишається на ноутбуці; **не комітити** в репо.
7. **Backups:** включи **Automated Backups** (~+20% до місячної ціни). Це провайдер-side daily snapshots — окремо від `08-backups.md` restic-схеми, дублювання навмисне. Якщо бюджет тісний — пропусти, але §08 restic-flow стає єдиним рятувальним кругом.
8. **Period:** monthly billing для початку (≈€10-12/міс для VPS-2 Comfort у Warsaw). Annual дає ~10% знижки, але міняти план потім складніше.
9. **Anti-DDoS:** **OVH Game DDoS protection НЕ потрібен** (це для game-servers, дорого, додаткова латентність). Базовий OVH anti-DDoS уже включений безкоштовно.
10. **Pay** → wait for confirmation email (~2-5 хв) → email міститиме: **IPv4**, **IPv6**, **root SSH credentials**.

> Збережи IPv4 у password manager — це `<IPV4>` для всього playbook.
>
> **Snapshot:** після того як playbook §01..§08 пройдено і smoke-tests зелені — зайди в OVH UI → VPS → Snapshots → Take Snapshot ("baseline-prod-ready"). Це безкоштовний rollback-checkpoint на випадок якщо щось зламаєш через тиждень.

## 0.5. Claude Code CLI installation on VPS (manual bootstrap)

Якщо ти плануєш делегувати steps §01..§08 (Phase 2) AI-агенту через `AI-RUNBOOK.md` — спочатку треба **вручну** довести VPS до стану, де Claude Code CLI зможе на ньому запуститися. Це ~10 хвилин ручної роботи; після цього AI бере все на себе.

> Якщо ти проходиш playbook вручну, без AI — пропусти цей розділ і йди прямо до `01-server-bootstrap.md`.

### 0.5.1. Первинний root SSH

```bash
ssh -i ~/.ssh/finly_vps ubuntu@<IPV4>
# Або, якщо OVH створив root-only access:
ssh -i ~/.ssh/finly_vps root@<IPV4>
```

Якщо OVH запропонував зміну root password при першому login — встанови сильний (32+ chars), збережи у password manager. Він знадобиться рівно один раз.

### 0.5.2. Bare-minimum apt baseline

Це підмножина того, що `01-server-bootstrap.md` зробить повноцінно потім. Зараз — мінімум, щоб поставити Node:

```bash
apt update
apt -y install curl ca-certificates gnupg
```

### 0.5.3. Non-root sudo user

Claude Code (і весь подальший deploy) має жити під **non-root** user-ом. Якщо ти зайшов як root:

```bash
adduser --disabled-password --gecos "" ubuntu
usermod -aG sudo ubuntu

# Скопіювати root's authorized_keys → ubuntu, щоб ssh-key login працював
install -d -m 700 -o ubuntu -g ubuntu /home/ubuntu/.ssh
cp /root/.ssh/authorized_keys /home/ubuntu/.ssh/authorized_keys
chown ubuntu:ubuntu /home/ubuntu/.ssh/authorized_keys
chmod 600 /home/ubuntu/.ssh/authorized_keys

# Passwordless sudo для нього (тимчасово — playbook §02 потім ужорсточить)
echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-ubuntu
chmod 440 /etc/sudoers.d/90-ubuntu
```

Якщо OVH одразу створив `ubuntu` user-а з sudo (деякі OVH templates так роблять) — пропусти цей крок, перевір лише `groups ubuntu` має `sudo`.

### 0.5.4. Logout + SSH як non-root

```bash
exit
ssh -i ~/.ssh/finly_vps ubuntu@<IPV4>
sudo whoami   # має повернути `root` без запиту пароля
```

### 0.5.5. Node 20 + Claude Code CLI

```bash
# Node 20 від NodeSource (Ubuntu archive має Node 18 LTS — застаре)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs

node --version    # повинно бути v20.x
npm --version

# Claude Code CLI глобально
sudo npm install -g @anthropic-ai/claude-code
claude --version
```

### 0.5.6. Authentication

Claude Code потребує Anthropic API key або subscription auth. Найпростіший варіант — API key:

```bash
claude login
# Інтерактивний prompt — paste API key з https://console.anthropic.com → API Keys
```

Або через env var:

```bash
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.bashrc
source ~/.bashrc
```

> **Безпека:** цей API key буде використовуватись AI-агентом на VPS. Обмеж його rate-limit у Anthropic console (`$50/day soft cap`) на випадок якщо AI зациклиться у tool-call loop. Окремий API key від dev — щоб ротувати незалежно.

### 0.5.7. Дай AI runbook

Дві опції:

**(a) Paste через TUI** (найпростіше):
```bash
claude   # запускає interactive TUI
# Потім paste-уй ВЕСЬ зміст AI-RUNBOOK.md як першу message.
```

**(b) Через file** (якщо repo публічний):
```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/finly/main/docs/server-playbook/AI-RUNBOOK.md > /tmp/runbook.md
claude
# Потім: "Read /tmp/runbook.md and execute it phase by phase."
```

> **Перед стартом AI** переконайся, що у тебе під рукою (для handoff-points):
> - `.env` файл готовий (повністю заповнений по §1..§11 нижче)
> - `origin.pem` + `origin-key.pem` (Cloudflare Origin Cert, §2)
> - R2 backup token + restic password (§8 нижче, готується пізніше)
> - GitHub deploy key (читай-only) на repo або repo вже публічний

AI зупинятиметься на handoff-points і питатиме ці значення у тебе через чат.

## 1. Cloudflare DNS

В дашборді Cloudflare для `finly.com.ua`:

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `@` | `<IPV4>` (з провайдера VPS) | proxied (orange cloud) |
| AAAA | `@` | `<IPV6>` (якщо є) | proxied |
| CNAME | `www` | `finly.com.ua` | proxied |
| CNAME | `pay` | `finly.com.ua` | proxied |
| CNAME | `media` | `<R2_PUBLIC_BUCKET_HOSTNAME>` (див. R2 нижче) | proxied |

SSL/TLS → Overview → **Full (strict)**. `Always Use HTTPS` ON, `Min TLS Version` 1.2.

## 2. Cloudflare Origin Certificate

SSL/TLS → Origin Server → Create Certificate:

- **Hostnames:** `finly.com.ua`, `*.finly.com.ua` (wildcard критично — Caddy використовує його для `pay.`, `www.`, і будь-якого майбутнього суб-домена)
- **Validity:** 15 років
- Зберегти `origin.pem` і `origin-key.pem` (private key показано рівно один раз).

Файли підуть у `/etc/caddy/tls/origin.pem` + `origin-key.pem` (крок §06).

## 3. MongoDB Atlas (production cluster)

- **Cluster tier:** мінімум M10 (M0 free-tier не дає TX-snapshots і має connection-limit 500 — Finly cascade-delete вимагає `withTransaction` на replica-set).
- **Region:** Europe (Frankfurt / Amsterdam) — низька латентність до VPS.
- **Network access:** додати public IP VPS у whitelist (`<IPV4>/32`). Альтернативно — Atlas VPC Peering / PrivateLink, якщо провайдер підтримує.
- **Database user:** dedicated `finly-api` user, password 32+ chars, **readWrite** на `finly` DB only.
- **Connection string** (Atlas → Connect → Drivers):
  ```
  mongodb+srv://finly-api:<password>@<cluster>.mongodb.net/finly?retryWrites=true&w=majority&appName=finly-api
  ```
  → `.env` `MONGODB_URI`.

> **Backup:** Atlas M10+ робить continuous backup (24h restore window). У §08 playbook `mongodump` опціональний — можна вимкнути, якщо довіряєте провайдер-snapshot-ам.

## 4. Payments provider — Stripe (placeholder до міграції на локального UA-провайдера)

**Контекст.** Поточна реалізація `PAYMENT_PROVIDER`-абстракції (`apps/api/src/modules/payments/providers/stripe.service.ts`) — Stripe. Stripe не приймає платежі від українських ФОП-карток у production-сценаріях Finly, тому MVP-launch не активує buyer-facing checkout-flow. Заміна на локального провайдера (LiqPay / Fondy / WayForPay / Monobank Acquiring — рішення відкладене) — окремий майбутній спринт.

**Що це означає для deploy-у.** Env vars `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` усе ще required (`apps/api/src/config/env.ts` fail-fast), `CatalogService` warm-fetch на startup ходить у Stripe (інакше API не стартує), `ThrottlerModule` тримає `webhook` route відкритим. Тобто **валідні Stripe credentials у `.env` обовʼязкові навіть якщо buyer-facing UI checkout-flow вимкнена**. Використовуємо **Stripe test-mode** як placeholder — це бесплатно, фейкові тестові карти не приймають реальних грошей, але дозволяють `CatalogService` і `webhook` route жити.

1. Stripe Dashboard → акаунт у Live mode залишається **неактивованим** (skip Activate).
2. Toggle у top-left → **Test mode**.
3. Developers → API keys → `Secret key (test)` → `.env` `STRIPE_SECRET_KEY` (`sk_test_...`).
4. Products → у test-режимі створи Subscription + One-off products з `metadata.planCode` + `metadata.executions` + `metadata.featured` — фактичні значення з dev-каталогу (`pnpm --filter api -- ts-node scripts/dump-stripe-catalog.ts` як reference; якщо такого скрипта немає — переглянь у Stripe dev-dashboard). Без цього `CatalogService.warm` крашить API на старті.
5. Developers → Webhooks → **Add endpoint**:
   - URL: `https://finly.com.ua/api/payments/webhook/stripe`
   - **Реальний whitelist** (`providers/stripe.service.ts:88-96`):
     - `checkout.session.completed`
     - `checkout.session.async_payment_succeeded`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
   - Інші events Stripe доставить, але `StripeService.handleWebhook` ігнорує їх (повертає 200) — підписуй тільки whitelist, щоб не засмічувати Logs.
   - Signing secret → `.env` `STRIPE_WEBHOOK_SECRET` (`whsec_...`).

> **Продуктова поведінка.** Buyer-facing CTA (`Subscribe to plan`, `Buy executions`) має бути приховано / disabled на frontend до моменту міграції. Це окреме рішення поза цим чек-листом — переконайся, що його ухвалено перед запуском, інакше користувач натисне Subscribe → отримає Stripe test-checkout, який нічого не активує.
>
> **На момент міграції** — нова локальна платіжка реалізує `IPaymentProvider`, реєструється у `payment-provider.provider.ts` замість `StripeService`. Env vars Stripe лишаються до перехідного періоду (rollback safety) або видаляються через окремий env-cleanup PR.

## 5. Google OAuth (production credentials)

Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID:

- **Authorized JavaScript origins:** `https://finly.com.ua`
- **Authorized redirect URIs:** `https://finly.com.ua/api/auth/google/callback`
- Client ID + Client Secret → `.env` `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `.env` `GOOGLE_CALLBACK_URL` = `https://finly.com.ua/api/auth/google/callback`

> Окремий OAuth client від dev — dev має `http://localhost:3000` redirect, ці URI не можна змішувати в одному credential.

## 6. Resend (production sender)

1. Resend Dashboard → **Domains → Add domain** → `finly.com.ua`.
2. Додати DNS-records, які Resend видасть (SPF, DKIM, optionally DMARC) — у Cloudflare DNS, **DNS-only (grey cloud)**.
3. Дочекатися статусу `Verified` (зазвичай <5 хв).
4. API Keys → Create → scoped до `sending` → `.env` `RESEND_API_KEY` (`re_...`).
5. `.env` `RESEND_FROM_EMAIL` = `Finly <no-reply@finly.com.ua>` (sender має жити на verified domain — інакше Resend rejects).

## 7. Cloudflare R2 (media bucket)

1. R2 → Create bucket → `finly-media`. Region: automatic.
2. Bucket → Settings → **Public access** → enable. Скопіювати `R2.dev` URL.
3. Опціонально (рекомендовано): Bucket → Custom Domains → Add → `media.finly.com.ua`. Це створює CNAME у Cloudflare DNS автоматично (звір з §1 — запис `media`).
4. R2 → Manage API Tokens → Create:
   - Permissions: **Object Read & Write**
   - TTL: forever
   - Bucket: `finly-media` only
   - → `.env` `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` (Account ID — у R2 sidebar)
5. `.env` `R2_BUCKET_NAME=finly-media`
6. `.env` `R2_PUBLIC_URL=https://media.finly.com.ua` (custom domain) — **hostname МУСИТЬ збігатися** з `NEXT_PUBLIC_STORAGE_HOSTNAME`, інакше `next/image` блокує фото (`next.config.ts` fail-fast).
7. `.env` `NEXT_PUBLIC_STORAGE_HOSTNAME=media.finly.com.ua`

> Окремий R2 bucket для backups — `finly-backups`, окремий API token, scoped до нього (див. §08 playbook).

## 8. Anthropic API (AI chat)

console.anthropic.com → API Keys → Create. → `.env` `ANTHROPIC_API_KEY` (`sk-ant-...`).

> Production budget alert у Anthropic console — рекомендовано $50 / week soft cap, бо `AI_CHAT_IP_LIMIT=5/day` не захищає від high-traffic IP-blocks.

## 9. JWT secrets

Згенерувати локально на ноутбуці:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

→ `.env` `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`.

> Окремі від dev. Якщо колись prod-secret leak — rotate тут і `compose restart api` (всі сесії revoke-нуться).

## 10. GitHub Actions secrets

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Значення |
|---|---|
| `VPS_HOST` | `<IPV4>` (або DNS-name, якщо налаштовано) |
| `VPS_USER` | `ubuntu` (deploy-user з §02) |
| `VPS_SSH_KEY` | private SSH key цього юзера (формат: повний `-----BEGIN OPENSSH PRIVATE KEY-----...`). Згенерувати окрему пару `id_ed25519_finly_deploy` на ноутбуці, public-частину додати у `~/.ssh/authorized_keys` ubuntu-юзера на VPS. |
| `VPS_DEPLOY_PATH` | `/opt/finly` |

> `deploy.yml` workflow тригериться на `workflow_run` після CI на `main` — щойно секрети додані, наступний merge у `main` запустить SSH-deploy.

## 11. Production `.env` — повний приклад

Заповнити на VPS у `/opt/finly/.env` (крок §05 playbook). Всі ключі required (fail-fast у `apps/api/src/config/env.ts`).

```env
# ─── Runtime ───
NODE_ENV=production
PORT=4000
WEB_PORT=3000
API_PORT=4000

# ─── Backend ───
WEB_URL=https://finly.com.ua
PAY_PUBLIC_URL=https://pay.finly.com.ua
MONGODB_URI=mongodb+srv://finly-api:<password>@<cluster>.mongodb.net/finly?retryWrites=true&w=majority&appName=finly-api
REDIS_URL=redis://redis:6379

JWT_ACCESS_SECRET=<32-byte hex з §9>
JWT_REFRESH_SECRET=<32-byte hex з §9>

GOOGLE_CLIENT_ID=<з §5>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<з §5>
GOOGLE_CALLBACK_URL=https://finly.com.ua/api/auth/google/callback

RESEND_API_KEY=<з §6>
RESEND_FROM_EMAIL=Finly <no-reply@finly.com.ua>

STRIPE_SECRET_KEY=sk_test_<з §4 — Stripe test-mode placeholder, не live>
STRIPE_WEBHOOK_SECRET=whsec_<з §4 — test-mode webhook signing secret>
# Hoча buyer-facing checkout-CTA вимкнено на frontend (див. §4),
# `env.ts` фейл-фастить якщо обидва toggle = false, тому лишаємо true/true.
PAYMENTS_SUBSCRIPTION_ENABLED=true
PAYMENTS_ONE_OFF_ENABLED=true

ANTHROPIC_API_KEY=sk-ant-<з §8>
AI_CHAT_MAX_TOKENS=300
AI_CHAT_IP_LIMIT=5

AUTH_PASSWORD_MIN_LENGTH=8
AUTH_LOCKOUT_THRESHOLDS=5:1,10:5,20:15
AUTH_LOGIN_ATTEMPTS_TTL_MIN=15
AUTH_MAGIC_LINK_TTL_MIN=15
AUTH_MAGIC_LINK_RATE_LIMIT=3
AUTH_MAGIC_LINK_RATE_WINDOW_MIN=15
AUTH_MAGIC_LINK_DEDUP_SEC=60
ACCOUNT_DELETION_GRACE_DAYS=30

ORPHAN_REMINDER_FIRST_DAYS=1
ORPHAN_REMINDER_FINAL_DAYS=6
ORPHAN_CLEANUP_DELETION_DAYS=7

R2_ACCOUNT_ID=<з §7>
R2_ACCESS_KEY_ID=<з §7>
R2_SECRET_ACCESS_KEY=<з §7>
R2_BUCKET_NAME=finly-media
R2_PUBLIC_URL=https://media.finly.com.ua

# ─── Frontend (build args + runtime) ───
API_INTERNAL_URL=http://api:4000
NEXT_PUBLIC_BASE_URL=https://finly.com.ua
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_PAY_PUBLIC_URL=https://pay.finly.com.ua
NEXT_PUBLIC_PAYMENTS_SUBSCRIPTION_ENABLED=true
NEXT_PUBLIC_PAYMENTS_ONE_OFF_ENABLED=true
NEXT_PUBLIC_STORAGE_HOSTNAME=media.finly.com.ua
```

`chmod 600 .env`, owner = `<USER>:<USER>`.

## 12. Post-deploy smoke tests

Після того, як `01..08` пройдено й перший `docker compose up -d --build` показав `(healthy)`:

- [ ] `curl -sS -I https://finly.com.ua/` → `200`, заголовки `strict-transport-security`, `x-frame-options: DENY`, `content-encoding: zstd|gzip`, БЕЗ `server: Caddy`.
- [ ] `curl -sS -o /dev/null -w "%{http_code}\n" https://pay.finly.com.ua/` → **`404`** (підтверджує host-isolation: public host віддає лише `/{biz}` / `/{biz}/{acc}` / `/{biz}/{acc}/{inv}` патерни — `apps/web/src/proxy.ts` Branch B; `200` на root зламав би інваріант ізоляції).
- [ ] `curl -sS -I https://www.finly.com.ua/` → `301` → `https://finly.com.ua/`.
- [ ] `curl -sS https://finly.com.ua/api/health` → `200` (API healthcheck через web reverse-proxy).
- [ ] Cabinet login → magic-link приходить (Resend dashboard → Logs → status 200).
- [ ] Google OAuth → авторизація → редірект на `/business` (без 400 redirect_uri_mismatch).
- [ ] Створити business → IBAN account → invoice. Скопіювати public-URL інвойсу → відкрити у браузері incognito (`https://pay.finly.com.ua/<biz>/<acc>/<inv>`) → 200, рендериться QR + реквізити.
- [ ] `GET https://pay.finly.com.ua/api/businesses/public/<biz>/account/<acc>/invoices/<inv>/qr/nbu.png?host=primary` → PNG (NBU payload-QR, читається банк-app-ом — звір з `docs/manual-checks/`).
- [ ] R2 avatar upload — кабінет → Profile → upload .jpg → перевірити `media.finly.com.ua/avatars/...` 200.
- [ ] `docker compose ps` — усі контейнери `Up`. Healthcheck-блоків у `docker-compose.yml` немає (deploy перевіряє через `curl` у `deploy.yml`), але всі три сервіси мають бути в стані `running`, не `restarting`.
- [ ] `journalctl -u caddy -n 50` — без `400/502` репорту.
- [ ] **Payments**: NOT included у smoke-test. Buyer-facing CTA має бути вимкнено на frontend (див. §4) — спроба натиснути Subscribe має бути неможлива, або веде у явне "Платежі тимчасово недоступні" повідомлення.

Якщо все зелене — рухайся до `99-runbook.md` як reference для incident-response. Інакше — кожна failure-row має конкретний log location у §99.
