# Server Playbook — production VPS for a Dockerised web app

Step-by-step guide to bring up a production-grade single-VPS stack on Ubuntu 24.04, modelled on the live `cyanship.com` server (OVH, Docker compose stack behind Caddy + Cloudflare). Everything in here is real — every command was either run on the production box or directly derived from a working config.

## Target stack

- **Host:** Ubuntu 24.04 LTS, 8 GB RAM, ~70 GB SSD, single non-root sudo user.
- **App:** Next.js + NestJS + Redis in Docker compose (or any equivalent), repo cloned to `/opt/<project>`.
- **TLS / proxy:** Caddy v2 with a Cloudflare Origin Certificate, reverse-proxy `127.0.0.1:3000`.
- **CDN / DNS:** Cloudflare in front (Full Strict mode).
- **Hard perimeter:** UFW (22/80/443), fail2ban (sshd), key-only SSH, root login off.
- **Backups:** restic → Cloudflare R2 (or B2/S3), nightly, 7d / 4w / 6m retention.
- **Updates:** unattended-upgrades + auto-reboot 04:00 Sunday.

## How to use this playbook

Read the files in numeric order. Each file is self-contained: explanation → exact commands → verification step. Where a command produces a value you need later (R2 keys, fingerprints), the file says so.

Replace these placeholders everywhere:

| Placeholder | Meaning | Example |
|---|---|---|
| `<DOMAIN>` | apex domain | `cyanship.com` |
| `<EMAIL>` | ops contact, used for Let's Encrypt fallback | `ops@example.com` |
| `<USER>` | non-root sudo user | `ubuntu` |
| `<PROJECT>` | repo / compose project name | `cyanship` |
| `<R2_ACCOUNT_ID>` | Cloudflare R2 account ID | `abcd1234…` |
| `<R2_ACCESS_KEY_ID>` / `<R2_SECRET_ACCESS_KEY>` | R2 API token, scoped to one bucket | `…` |
| `<GITHUB_REPO>` | git URL of the app repo | `git@github.com:org/repo.git` |

## Files

| # | File | What it does |
|---|---|---|
| 0 | `README.md` | This file. Index + preflight. |
| 1 | `01-server-bootstrap.md` | Provision VPS, first SSH, hostname, timezone, NTP, base updates. |
| 2 | `02-security-hardening.md` | Non-root sudo, key-only SSH, sshd hardening, UFW, fail2ban, secrets perms. |
| 3 | `03-swap-and-tuning.md` | Swap file, `vm.swappiness`, sysctl tweaks, journal limits. |
| 4 | `04-docker.md` | Install docker-ce + buildx + compose, `daemon.json` (log-opts + live-restore), prune cron. |
| 5 | `05-app-deploy.md` | Clone repo to `/opt/<PROJECT>`, `.env` template, healthchecks, `compose up -d`. |
| 6 | `06-caddy-cloudflare.md` | Install Caddy, Cloudflare DNS + Origin Cert, Caddyfile (headers, encode, log). |
| 7 | `07-monitoring.md` | Uptime checks, log inspection commands, optional Netdata/ctop. |
| 8 | `08-backups.md` | restic → R2, daily cron, retention 7/4/6, mongodump, restore drill. |
| 99 | `99-runbook.md` | Incident playbooks: site down, OOM, disk full, cert broken, locked out, key compromise. |

## Preflight checklist

Before running any of the steps below, gather:

- [ ] VPS provider account, SSH key uploaded.
- [ ] Domain `<DOMAIN>` registered, DNS managed by Cloudflare.
- [ ] GitHub deploy key (read-only) for the app repo, or PAT stored elsewhere.
- [ ] Cloudflare R2 bucket `<PROJECT>-backups` + scoped API token (Object Read & Write).
- [ ] All third-party API keys the app needs (Stripe, Resend, OAuth, etc.) collected in a password manager.
- [ ] Cloudflare Origin Certificate generated for `<DOMAIN>` and `*.<DOMAIN>` (15 years recommended).

Total bring-up time on a fresh OVH/Hetzner box: ~60–90 min including DNS propagation.

## Liveness check (run after every change)

```bash
curl -sS -o /dev/null -w "https://<DOMAIN> -> %{http_code} ttfb=%{time_starttransfer}s\n" -L --max-time 8 https://<DOMAIN>/
docker ps --format "table {{.Names}}\t{{.Status}}"
systemctl is-active caddy docker fail2ban ufw
```

Expected: `200`, all containers `Up (healthy)`, all services `active`. If anything is red, stop and consult `99-runbook.md`.
