# 08 — Backups

Goal: nightly off-site backup of everything you can't reconstitute from `git pull` + provider dashboards: `.env`, TLS keys, system configs, Redis state, MongoDB Atlas dump. Target RPO 24 h, RTO ~30 min on a fresh VPS.

Tool: [restic](https://restic.net/) → Cloudflare R2 (S3-compatible). Backblaze B2 or AWS S3 work identically — only the endpoint URL changes.

## 1. R2 bucket + API token

In Cloudflare dashboard:

1. **R2 → Create bucket** → `<PROJECT>-backups`. Default region is fine. Object lifecycle: optional, e.g. "Abort multipart uploads after 1 day".
2. **R2 → Manage R2 API Tokens → Create API token**:
   - Permissions: **Object Read & Write**.
   - Bucket: limit to `<PROJECT>-backups` only.
   - Save the **Access Key ID**, **Secret Access Key**, and **Account ID** (shown in the R2 sidebar).

## 2. Install restic

```bash
sudo apt -y install restic
restic version           # should be 0.16+
```

## 3. Repo password

```bash
sudo install -d -m 700 /root
sudo umask 077
openssl rand -base64 48 | sudo tee /root/.restic-password > /dev/null
sudo chmod 600 /root/.restic-password
```

**Print this password and store it somewhere off-server (password manager, sealed envelope).** Lose it and the backup is unrecoverable, even with R2 access.

## 4. Restic config file

```bash
sudo install -d -m 700 -o root -g root /etc/restic
sudo tee /etc/restic/<PROJECT>.env <<'EOF'
RESTIC_REPOSITORY=s3:https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/<PROJECT>-backups
RESTIC_PASSWORD_FILE=/root/.restic-password
AWS_ACCESS_KEY_ID=<R2_ACCESS_KEY_ID>
AWS_SECRET_ACCESS_KEY=<R2_SECRET_ACCESS_KEY>
EOF
sudo chmod 600 /etc/restic/<PROJECT>.env
```

## 5. Initialise the repo (one-time)

```bash
sudo bash -c 'set -a; . /etc/restic/<PROJECT>.env; set +a; restic init'
sudo bash -c 'set -a; . /etc/restic/<PROJECT>.env; set +a; restic snapshots'
```

## 6. Backup script

Save as `/usr/local/sbin/<PROJECT>-backup.sh`:

```bash
#!/usr/bin/env bash
# <PROJECT>-backup.sh — daily backup of secrets, configs, Redis state, and MongoDB Atlas
# dump to a restic repo on Cloudflare R2.
# Repo + R2 credentials live in /etc/restic/<PROJECT>.env.
#
# MongoDB Atlas free tier (M0) does not provide provider-side backups, so we self-dump
# via `mongodump` (mongo:7 image) on every run. On paid tiers, Atlas provides snapshot
# backups — you can drop the mongodump section.

set -euo pipefail

LOG=/var/log/<PROJECT>-backup.log
exec >> "$LOG" 2>&1
echo
echo "===== $(date -u +%FT%TZ) backup start ====="

ENV_FILE=/etc/restic/<PROJECT>.env
APP_ENV=/opt/<PROJECT>/.env

if [ ! -r "$ENV_FILE" ]; then
    echo "FATAL: $ENV_FILE missing or unreadable" >&2
    exit 1
fi
set -a
. "$ENV_FILE"
set +a

REDIS_CONTAINER=<PROJECT>-redis-1
REDIS_VOL=/var/lib/docker/volumes/<PROJECT>_redis_data/_data
STAGE=$(mktemp -d -t <PROJECT>-backup-XXXXXX)
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

# 1. Trigger Redis BGSAVE and snapshot the dump
if docker ps --format '{{.Names}}' | grep -qx "$REDIS_CONTAINER"; then
    LAST_BEFORE=$(docker exec "$REDIS_CONTAINER" redis-cli LASTSAVE | tr -d '\r\n')
    docker exec "$REDIS_CONTAINER" redis-cli BGSAVE > /dev/null
    for i in $(seq 1 30); do
        sleep 1
        LAST_NOW=$(docker exec "$REDIS_CONTAINER" redis-cli LASTSAVE | tr -d '\r\n')
        if [ "$LAST_NOW" != "$LAST_BEFORE" ]; then
            echo "redis: BGSAVE complete after ${i}s"
            break
        fi
        [ "$i" = "30" ] && echo "redis: BGSAVE timeout after 30s — continuing" >&2
    done
    mkdir -p "$STAGE/redis"
    cp "$REDIS_VOL/dump.rdb" "$STAGE/redis/" 2>/dev/null || echo "redis: no dump.rdb yet"
    [ -d "$REDIS_VOL/appendonlydir" ] && cp -r "$REDIS_VOL/appendonlydir" "$STAGE/redis/"
fi

# 2. MongoDB Atlas dump (skip if MONGODB_URI absent)
if [ -r "$APP_ENV" ]; then
    MONGODB_URI=$(grep -E '^MONGODB_URI=' "$APP_ENV" | head -1 | cut -d= -f2-)
    MONGODB_URI=${MONGODB_URI%\"}; MONGODB_URI=${MONGODB_URI#\"}
    MONGODB_URI=${MONGODB_URI%\'}; MONGODB_URI=${MONGODB_URI#\'}
fi
if [ -n "${MONGODB_URI:-}" ]; then
    mkdir -p "$STAGE/mongo"
    if docker run --rm \
        -v "$STAGE/mongo:/dump" \
        -e "MONGODB_URI=$MONGODB_URI" \
        mongo:7 \
        sh -c 'mongodump --uri="$MONGODB_URI" --out=/dump --quiet' \
        2>&1 | sed 's/^/mongo: /'
    then
        echo "mongo: dump complete ($(du -sb "$STAGE/mongo" | cut -f1) bytes)"
    else
        echo "mongo: mongodump FAILED — continuing" >&2
        rm -rf "$STAGE/mongo"
    fi
fi

# 3. Paths to back up (skip missing ones)
PATHS=()
for p in \
    /opt/<PROJECT>/.env \
    /opt/<PROJECT>/compose.yaml \
    /opt/<PROJECT>/Caddyfile \
    /etc/caddy \
    /etc/ssh/sshd_config \
    /etc/ssh/sshd_config.d \
    /etc/ufw \
    /etc/fail2ban/jail.local \
    /etc/fail2ban/jail.d \
    /etc/docker/daemon.json \
    "$STAGE/redis" \
    "$STAGE/mongo"; do
    [ -e "$p" ] && PATHS+=("$p")
done

# 4. Backup
restic backup \
    --tag <PROJECT> \
    --tag scheduled \
    --host "$(hostname -s)" \
    "${PATHS[@]}"

# 5. Forget + prune
restic forget --group-by host,tags \
    --tag <PROJECT> \
    --keep-daily 7 \
    --keep-weekly 4 \
    --keep-monthly 6 \
    --prune

# 6. Weekly integrity check (Sunday UTC, 5% sampled)
DOW=$(date -u +%u)
[ "$DOW" = "7" ] && restic check --read-data-subset=5%

echo "===== $(date -u +%FT%TZ) backup ok ====="
```

Make executable and own:

```bash
sudo chown root:root /usr/local/sbin/<PROJECT>-backup.sh
sudo chmod 750 /usr/local/sbin/<PROJECT>-backup.sh
```

## 7. Cron

```bash
sudo tee /etc/cron.d/<PROJECT>-backup <<'EOF'
# <PROJECT> daily backup → R2 via restic
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
15 3 * * * root /usr/local/sbin/<PROJECT>-backup.sh
EOF
```

03:15 UTC sits before the 04:00 unattended-upgrade reboot window — keeps both jobs from competing on Sunday.

Optional: ping a Healthchecks.io URL after the backup finishes successfully — append to the script:

```bash
curl -fsS -m 10 --retry 3 https://hc-ping.com/<UUID> > /dev/null 2>&1 || true
```

## 8. Test it now

```bash
sudo /usr/local/sbin/<PROJECT>-backup.sh
sudo bash -c 'set -a; . /etc/restic/<PROJECT>.env; set +a; restic snapshots --compact'
```

Expected: at least one snapshot listed. Inspect the log if it failed:

```bash
sudo tail -50 /var/log/<PROJECT>-backup.log
```

## 9. Restore drill (do this BEFORE you need it)

In a temp directory:

```bash
mkdir /tmp/restore && cd /tmp/restore
sudo bash -c '
set -a; . /etc/restic/<PROJECT>.env; set +a
restic restore latest --target /tmp/restore --include /opt/<PROJECT>/.env
'
ls -la /tmp/restore/opt/<PROJECT>/
diff /tmp/restore/opt/<PROJECT>/.env /opt/<PROJECT>/.env   # empty = perfect restore
sudo rm -rf /tmp/restore
```

For a Mongo restore drill spin up a throwaway Mongo container and `mongorestore --uri=...`. Don't restore over your live Atlas DB unless the building is on fire.

## 10. Disaster recovery — bring up a new VPS

If the original box is gone:

1. Stand up a new VPS (same Ubuntu 24.04). Run `01` through `04` from this playbook.
2. Install restic, drop in `/etc/restic/<PROJECT>.env` (R2 keys + repo URL) and `/root/.restic-password`.
3. `restic restore latest --target /` (yes, root) — this restores `/opt/<PROJECT>`, `/etc/caddy`, configs.
4. `cd /opt/<PROJECT> && docker compose up -d --build`.
5. `mongorestore` the latest mongo dump from `/tmp/<STAGE>/mongo/` (extract from the snapshot first).
6. Re-run step 06 (Caddy/Cloudflare) — the cert+key files come back from the restore; only the DNS A record needs updating to the new IP.

Test this once a quarter on a throwaway VPS. RTO target: 30 min from clean image to live `200`.

## 11. What is NOT in this backup

- The git repo itself — recover with `git clone` from GitHub.
- Docker images — recover with `docker compose up -d --build`.
- MongoDB Atlas (if you're on a paid tier with provider snapshots) — verify in the Atlas dashboard, then optionally drop the mongodump section.
- Cloudflare R2 stored objects — that's product data; back it up separately or rely on R2's own durability (11 nines).

Move to `99-runbook.md`.
