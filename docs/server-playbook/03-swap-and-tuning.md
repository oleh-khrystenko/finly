# 03 — Swap and kernel tuning

Goal: prevent docker-build OOM kills on memory-tight VPSes (any web framework's production build can spike to 2–3 GB), and set sensible journald/sysctl defaults.

## 1. Add a swap file

4 GB is enough for an 8 GB VPS. On 4 GB hosts go to 6 GB. SSDs handle this fine; `swappiness=10` keeps the kernel from being eager about it.

```bash
# refuse to clobber an existing swap
swapon --show
[ -e /swapfile ] && { echo "swapfile already exists"; exit 1; }

sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# persist across reboots
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Verify:

```bash
swapon --show
free -h
```

`Swap` row should show 4 GB, used 0 B at first.

## 2. sysctl tuning

```bash
sudo tee /etc/sysctl.d/99-app-tuning.conf <<'EOF'
# Prefer keeping pages in RAM; only swap under real pressure.
vm.swappiness = 10

# Higher inotify limits — Next.js / webpack / chokidar will hit the default 8192.
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 1024

# Reasonable file-handle ceiling for a busy proxy + node app.
fs.file-max = 2097152

# TCP — modest tweaks for a public-facing reverse proxy.
net.core.somaxconn = 4096
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_keepalive_time = 300
EOF

sudo sysctl --system
```

Verify:

```bash
sysctl vm.swappiness fs.inotify.max_user_watches net.core.somaxconn
```

## 3. Journald limits

By default systemd-journal keeps logs until disk pressure forces rotation, which on a 70 GB VPS means hundreds of MB. Cap it:

```bash
sudo mkdir -p /etc/systemd/journald.conf.d
sudo tee /etc/systemd/journald.conf.d/99-size.conf <<'EOF'
[Journal]
SystemMaxUse=500M
SystemKeepFree=1G
SystemMaxFileSize=50M
EOF

sudo systemctl restart systemd-journald
journalctl --disk-usage
```

## 4. Open file limits for the deploy user

Helpful when running heavy node processes outside Docker (rare on this stack, but cheap insurance):

```bash
sudo tee /etc/security/limits.d/99-app.conf <<'EOF'
<USER>  soft  nofile  65536
<USER>  hard  nofile  65536
EOF
```

Effect requires a fresh login session.

## 5. Verification

```bash
free -h | grep -i swap        # Swap: 4.0Gi
sysctl vm.swappiness          # vm.swappiness = 10
sysctl fs.inotify.max_user_watches   # 524288
journalctl --disk-usage       # under 500M after a few days
```

Move to `04-docker.md`.
