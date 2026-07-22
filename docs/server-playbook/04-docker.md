# 04 — Docker

Goal: install docker-ce + buildx + compose v2 from the official Docker apt repo (NOT the `docker.io` package, which is the older, fork-managed Ubuntu build), configure log limits + live-restore, and add a weekly prune.

## 1. Install docker-ce

```bash
# Add Docker's official GPG key + apt repo (Ubuntu 24.04 = noble)
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu noble stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list

sudo apt update
sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# allow the deploy user to run docker without sudo
sudo usermod -aG docker <USER>
# log out & back in for group membership to take effect
```

Verify (after re-login):

```bash
docker version
docker compose version
docker buildx version
docker run --rm hello-world
```

## 2. `daemon.json` — log caps + live-restore

Without this, every container's `*-json.log` grows unbounded, and `docker` daemon restarts (e.g. apt upgrade of `docker-ce`) kill all containers.

```bash
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "live-restore": true
}
EOF

sudo systemctl restart docker
docker info | grep -E 'Logging Driver|Live Restore'
```

Expected:

```
Logging Driver: json-file
Live Restore Enabled: true
```

`live-restore: true` means containers keep running across `dockerd` restarts (apt upgrade, daemon crash). They won't be reachable for the few seconds dockerd is down — but they don't get stopped+started.

## 3. Weekly prune (images and build cache)

Without this, `/var/lib/containerd` grows by every CI rebuild. We've seen `docker buildx prune` reclaim 30 GB on a 6-month-old box.

```bash
# image prune — already in many distros via /etc/cron.weekly. Add explicit cron:
sudo tee /etc/cron.d/docker-image-prune <<'EOF'
# Cyanship: weekly cleanup of dangling images older than 7 days
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
0 4 * * 0 root docker image prune -af --filter 'until=168h' > /dev/null 2>&1
EOF

# build cache prune — older than 14 days
sudo tee /etc/cron.d/docker-buildx-prune <<'EOF'
# Cyanship: prune docker buildx cache older than 14 days, weekly on Sunday at 04:30
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
30 4 * * 0 root docker buildx prune -af --filter "until=336h" > /dev/null 2>&1
EOF
```

Confirm cron picked them up:

```bash
ls -la /etc/cron.d/
sudo run-parts --test /etc/cron.daily   # not required, just sanity
```

## 4. Verification

```bash
docker info | grep -E 'Server Version|Cgroup Driver|Storage Driver|Logging Driver|Live Restore'
docker system df
sudo systemctl is-enabled docker containerd
```

Expected:

- Server Version: 29.x
- Cgroup Driver: systemd
- Storage Driver: overlayfs
- Logging Driver: json-file
- Live Restore Enabled: true
- both services `enabled`

Move to `05-app-deploy.md`.

## Notes

- Do **not** install `docker.io` from the Ubuntu archive on production. It lags upstream by 6–12 months and the package layout is different.
- Buildx in compose v2 is the default; `docker compose build` uses BuildKit automatically.
- The `docker` group is effectively root — only the deploy user should be in it.
