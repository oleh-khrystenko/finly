# 99 — Runbook

When something is on fire. Each section is "symptom → likely cause → fix in order of probability". Run the liveness check first, always:

```bash
curl -sS -o /dev/null -w "https://<DOMAIN> -> %{http_code} ttfb=%{time_starttransfer}s\n" -L --max-time 8 https://<DOMAIN>/
docker ps --format "table {{.Names}}\t{{.Status}}"
systemctl is-active caddy docker fail2ban ufw
```

---

## A. Site is down (5xx or timeout)

### A.1 — `curl https://<DOMAIN>` times out

Cloudflare can't reach the origin.

1. From laptop: `dig <DOMAIN> +short` — does Cloudflare still resolve?
2. SSH to the box. If SSH also times out → provider-side outage or VPS dead. Check provider status page, reboot from console.
3. If SSH works: `systemctl is-active caddy` — restart if dead: `sudo systemctl restart caddy`.
4. `sudo ufw status` — confirm 80/443 still allowed.
5. `ss -tlnp | grep -E ':80|:443'` — Caddy listening? If not, `journalctl -u caddy -n 100`.

### A.2 — `curl https://<DOMAIN>` returns 502 / 504

Caddy is up but the upstream is broken.

1. `curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/` — does the web container respond locally?
2. `docker compose -f /opt/<PROJECT>/compose.yaml ps` — any container `unhealthy` or restarting?
3. `docker compose logs --tail=200 web` — last 200 lines of the web container.
4. If the container is healthy but slow → check `top` / `docker stats` for CPU/memory pressure.

Recovery:

```bash
cd /opt/<PROJECT>
docker compose restart web         # graceful
# or, if a recent deploy is suspect:
git log --oneline -5
git reset --hard <previous-good-sha>
docker compose up -d --build
```

### A.3 — `curl https://<DOMAIN>` returns 525 / 526

Cloudflare ↔ origin TLS handshake failed (Origin Cert expired/missing).

1. `sudo openssl x509 -in /etc/caddy/tls/origin.pem -noout -dates` — is `notAfter` in the future?
2. `sudo systemctl reload caddy` — pick up cert changes.
3. If cert really expired: regenerate in Cloudflare → SSL/TLS → Origin Server, paste new cert+key into `/etc/caddy/tls/origin{,-key}.pem`, reload.

---

## B. OOM kill / memory pressure

Symptom: containers restart, build fails with `Killed`, `dmesg` shows `Out of memory: Killed process`.

```bash
dmesg -T | grep -i -E 'oom|killed' | tail -20
free -h
swapon --show
docker stats --no-stream
```

Fixes in order:

1. If swap is missing → add it (see `03-swap-and-tuning.md`).
2. If a CI build is the culprit → build off-server (GitHub Actions) and just `docker compose pull` on the VPS.
3. If the app legitimately needs more RAM → resize the VPS at the provider.

---

## C. Disk full

```bash
df -h /
sudo du -h --max-depth=1 / 2>/dev/null | sort -h | tail
sudo du -h --max-depth=1 /var 2>/dev/null | sort -h | tail
docker system df
```

Most common offenders:

- `/var/lib/containerd` — image / build-cache bloat. Fix: `docker buildx prune -af` (will reclaim multi-GB).
- `/var/log/journal` — uncapped journals. Fix: `sudo journalctl --vacuum-size=200M`.
- `/var/log/caddy` — should rotate, but verify.
- `/var/lib/docker/containers/*/...-json.log` — check `daemon.json` log limits are applied; restart docker after editing.
- An accidental large file in the repo from a deploy — `find /opt/<PROJECT> -type f -size +100M`.

After clearing, restart docker only if you changed `daemon.json`:

```bash
sudo systemctl restart docker
```

---

## D. SSH locked out

You changed sshd config and your session is dead. **As long as you have the provider console**, you're fine.

1. Open the provider's web console (KVM / serial). Log in as `root` (provider usually allows console root) or `<USER>`.
2. `sudo cat /etc/ssh/sshd_config.d/01-hardening.conf`
3. Fix the offending directive.
4. `sudo sshd -t` — must be silent.
5. `sudo systemctl reload ssh`

If the issue is "I removed my own pubkey":

1. Console-login as your user.
2. `vim ~/.ssh/authorized_keys` — paste your key back.
3. `chmod 600 ~/.ssh/authorized_keys`

---

## E. SSH key compromised

Treat as a real breach.

1. Log in via provider console. **Do not** trust the existing SSH session.
2. `sudo passwd <USER>` — set a strong password (so attacker can't sudo if they got in via key but lacks password — although your sudoers may be NOPASSWD; check).
3. Replace `~/.ssh/authorized_keys` with a fresh key generated on a clean machine.
4. Rotate all secrets that lived in `/opt/<PROJECT>/.env` — every API key. The attacker had local read.
5. Rotate the restic password and re-encrypt the repo (`restic key add` new, `restic key remove` old).
6. Rotate the R2 API token.
7. `sudo last -F | head -50` — review login history.
8. `sudo journalctl -u ssh --since '7 days ago' | grep 'Accepted'` — confirm authorised logins only.

---

## F. Cloudflare Origin cert about to expire

Should fire 30 days before expiry from your monitoring. If not:

```bash
sudo openssl x509 -in /etc/caddy/tls/origin.pem -noout -dates
```

Renewal: Cloudflare → SSL/TLS → Origin Server → revoke old, create new (15 years), paste into `/etc/caddy/tls/origin{,-key}.pem`, `sudo systemctl reload caddy`. Verify with `curl -sI https://<DOMAIN>`.

---

## G. Docker daemon won't start

```bash
sudo journalctl -u docker -n 200 --no-pager
sudo dockerd --debug   # only as a last resort, in another terminal
```

Common causes:

- Corrupted `daemon.json` — `sudo python3 -c 'import json; json.load(open("/etc/docker/daemon.json"))'`. Fix syntax, restart.
- Disk full — see section C.
- Storage driver mismatch after a kernel/version skew — last-resort: stop docker, move `/var/lib/docker` aside, restart, restore.

---

## H. Backup didn't run (Healthchecks alert)

```bash
sudo tail -100 /var/log/<PROJECT>-backup.log
sudo systemctl status cron
sudo run-parts --test /etc/cron.daily   # not for /etc/cron.d, just sanity
```

Common causes:

- R2 credentials rotated and not updated in `/etc/restic/<PROJECT>.env`.
- `/root/.restic-password` permission accidentally changed → can't read.
- Mongo URI changed in `.env` and the script's parser broke.

After fixing, run manually:

```bash
sudo /usr/local/sbin/<PROJECT>-backup.sh
sudo bash -c 'set -a; . /etc/restic/<PROJECT>.env; set +a; restic snapshots --compact | tail'
```

---

## I. fail2ban hammering legitimate IP

Symptom: a developer can't SSH and shows up in `auth.log` as banned.

```bash
sudo fail2ban-client status sshd
sudo fail2ban-client unban <IP>
```

To allowlist permanently, add the IP to `/etc/fail2ban/jail.local`:

```ini
[DEFAULT]
ignoreip = 127.0.0.1/8 ::1 <IP>/32
```

`sudo systemctl restart fail2ban`.

---

## J. Generic "things are weird" sweep

```bash
uptime
free -h
df -h /
sudo journalctl -p err --since '1 hour ago' --no-pager
sudo dmesg -T | tail -30
docker ps
docker compose -f /opt/<PROJECT>/compose.yaml ps
sudo systemctl --failed
```

Anything noisy or red is the start of the trail.
