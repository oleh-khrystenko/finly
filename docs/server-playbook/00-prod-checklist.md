# 00 — Production preflight checklist

Перед тим, як ти сядеш виконувати playbook `01..08` на VPS, збери ВСЕ нижче в один документ (password-manager / notes). Кожен пункт каже, **де взяти значення** і **куди воно піде**. Якщо хочаб одне поле «TODO», `05-app-deploy.md` зламається на `getEnvVar(...) throw`.

Замінники з кореневого `README.md`:

| Placeholder | Значення для Finly |
|---|---|
| `<DOMAIN>` | `finly.com.ua` |
| `<PROJECT>` | `finly` |
| `<USER>` | `ubuntu` (рекомендований non-root sudo user — налаштовується у §02) |

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
