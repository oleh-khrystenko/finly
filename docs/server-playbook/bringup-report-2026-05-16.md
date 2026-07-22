# Production bring-up report — 2026-05-16

First production VPS bring-up of Finly. Executed by Claude Code CLI running on the VPS following `AI-RUNBOOK.md` (phases A → Z). This document is the as-of snapshot — for any subsequent re-bring-up, copy this file with a new date and update values.

## System state

| Item             | Value                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------- |
| Hostname         | `finly-prod-1`                                                                         |
| Public IPv4      | `51.68.172.94`                                                                         |
| Provider         | OVH (VPS-2, 8 GB / 2 vCPU / 80 GB SSD)                                                 |
| OS               | Ubuntu 24.04 LTS                                                                       |
| Kernel           | `6.8.0-111` running; `6.8.0-117` queued for next reboot (auto-reboot Sunday 04:00 UTC) |
| Uptime at report | 9h 53m                                                                                 |
| Load avg         | 1.17 (build/migration artefacts settling)                                              |
| Disk             | 13 / 72 GB used (18%)                                                                  |
| Swap             | 4 GB active (~268 KiB in use)                                                          |
| Services active  | `ssh`, `ufw`, `fail2ban`, `docker`, `caddy`, `sysstat`                                 |
| Containers       | `finly-api-1`, `finly-web-1`, `finly-redis-1` — all `Up 32m`                           |

## Network end-to-end (через Cloudflare)

| URL                               | Status                                             | Notes                                                                    |
| --------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ |
| `https://finly.com.ua/`           | `200`                                              | HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, `cf-ray` FRA |
| `https://pay.finly.com.ua/`       | `404`                                              | Host-isolation invariant (proxy.ts Branch B) — очікувано                 |
| `https://www.finly.com.ua/`       | `301` → `https://finly.com.ua/`                    | Caddy `www.` block                                                       |
| `https://finly.com.ua/api/health` | `200` `{"status":"ok","environment":"production"}` | Cabinet API healthcheck through Caddy reverse-proxy                      |

## Security

- SSH key-only: `PasswordAuthentication no`, `PermitRootLogin no`, `MaxAuthTries 3`, `ClientAliveInterval 300`
- UFW active, default deny incoming. Allow list: `22/tcp`, `80/tcp`, `443/tcp`
- fail2ban `sshd` jail active. **Caught 11 failed login attempts** during Phase B alone — internet-facing exposure baseline confirmed
- Passwordless sudo for `ubuntu` user — **свідомий trade-off** для AI-debugging convenience. Можна повернути password-required (`/etc/sudoers.d/90-ubuntu`) у будь-який момент без runtime impact.

## Backups

| Item             | Value                                                                   |
| ---------------- | ----------------------------------------------------------------------- |
| Tool             | `restic` 0.16.4                                                         |
| Repo             | `s3:https://<R2>.r2.cloudflarestorage.com/finly-backups`                |
| Repo id          | `5bf4057ac5`                                                            |
| First snapshot   | `c7b39528` — 54 files / 55 KiB (configs + mongodump 5448 B + redis dir) |
| Cron             | `15 3 * * *` daily                                                      |
| Retention        | 7 daily / 4 weekly / 6 monthly                                          |
| Integrity check  | Sunday `restic check --read-data-subset=5%`                             |
| Password storage | `/root/.restic-password` (on VPS) + user's password manager (off-VPS)   |

## Pending — browser smoke tests + ops follow-up

З §12 of `00-prod-checklist.md`, requires manual execution:

- [ ] Cabinet login (magic-link)
- [ ] Google OAuth flow → redirect to `/business`
- [ ] R2 avatar upload (потребує `media.finly.com.ua` CNAME у Cloudflare DNS, якщо ще не доданий)
- [ ] Public invoice QR render (`pay.finly.com.ua/<biz>/<acc>/<inv>`)
- [ ] Cloudflare WAF / rate-limit setup (опц., див. `06-caddy-cloudflare.md §7`)
- [ ] OVH snapshot `baseline-prod-ready`
- [ ] GitHub Actions secrets (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_DEPLOY_PATH`) → перший auto-deploy після push на main
- [ ] (опц., будь-коли) `sudo reboot` щоб активувати kernel `6.8.0-117`, або дочекатися auto-reboot

## Anomalies / things to monitor

### `pay.finly.com.ua/api/health` повертає 200

`/` на public host повертає 404 (host-isolation), але `/api/health` доступний. Причина: `proxy.ts` matcher excludes `/api/*` — middleware не пускає його через Branch B. API endpoint відповідає 200 з обох hostnames.

**Не критично** (healthcheck без даних), але якщо хочеш строгу host-isolation на API layer — додати `host`-check у `AppController` або обмежити через Caddy block. Записано як питання у backlog.

### Pre-existing sshd hardening file

При Phase B було знайдено `/etc/ssh/sshd_config.d/01-finly-hardening.conf` (subset hardening, що ми збиралися ставити). Джерело невідоме — OVH template чи ранній manual ssh. Runbook поклав `99-hardening.conf` зверху; lexical order у `sshd_config.d` гарантує що 99 override-ує 01. Конфлікту немає, але **варто перевірити **`01-finly-hardening.conf` під час наступного maintenance\*\*.

### Tooling deviations from runbook

- `ctop` встановлений з GitHub release (не у Ubuntu noble repos)
- `dstat` встановлений через `pcp` package (pure `dstat` deprecated на Ubuntu 24.04)

Обидві заміни функціонально еквівалентні runbook-овій рекомендації.

## Як rollback / re-bring-up

Файл `99-runbook.md` має incident playbooks. Для disaster scenarios:

1. **Lose VPS entirely** → новий OVH VPS, `01..04`, `restic restore latest --target /` з R2 credentials (зберегти ще і у password manager off-VPS), DNS A-record на new IP.
2. **Корупція state** → OVH snapshot `baseline-prod-ready` (після того як buyer-side smoke зелений).
3. **Bad deploy** → GitHub Actions `deploy.yml` має auto-rollback на попередній SHA через health-check loop (5 retries × 5s).
