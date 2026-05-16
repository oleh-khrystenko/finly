# 01 — Server bootstrap

Goal: get a vanilla Ubuntu 24.04 box to a known good baseline before doing anything app-specific.

## 1. Provision

Pick a provider, region close to your users, 4–8 GB RAM minimum (web framework builds eat RAM). Tested on OVH `vps-2024-le-2` (8 GB / 2 vCPU / 80 GB SSD). Hetzner `CPX21`/`CPX31` and DigitalOcean `s-2vcpu-4gb` work too.

At provisioning time:

- Image: **Ubuntu 24.04 LTS** (server, no GUI).
- Authentication: paste your SSH public key in the provider UI. Disable password login.
- Optional: enable provider-side daily snapshots (cheap insurance; ~20 % of VPS cost).
- Note the public IPv4 + IPv6.

## 2. First SSH

From your laptop:

```bash
ssh ubuntu@<IPV4>
```

If the provider gave you `root`-only access, log in as root, create the deploy user (next step), then never use root SSH again.

## 3. Hostname, timezone, locale

```bash
sudo hostnamectl set-hostname <PROJECT>-prod-1
echo "127.0.1.1 <PROJECT>-prod-1" | sudo tee -a /etc/hosts

sudo timedatectl set-timezone UTC          # keep server clocks in UTC, render in app
timedatectl                                 # verify

sudo locale-gen en_US.UTF-8
sudo update-locale LANG=en_US.UTF-8
```

`timedatectl` should show `System clock synchronized: yes` and `NTP service: active`. Ubuntu 24.04 ships `systemd-timesyncd` enabled — leave it alone.

## 4. Apt update + base tools

```bash
sudo apt update
sudo apt -y full-upgrade
sudo apt -y install \
    curl wget git ca-certificates gnupg lsb-release \
    htop ncdu jq unzip vim less bash-completion \
    ufw fail2ban
sudo apt -y autoremove --purge
```

`htop`, `ncdu`, `jq` are quality-of-life tools you will want during incidents.

## 5. Reboot if a new kernel was installed

```bash
[ -f /var/run/reboot-required ] && sudo reboot
```

Wait 60 s and reconnect. Confirm:

```bash
uname -r           # should be the latest 6.8.0-* installed by step 4
uptime             # fresh
```

## 6. Enable unattended security upgrades + auto-reboot

```bash
sudo apt -y install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades   # accept defaults
```

Add a local override so the box reboots itself when a kernel update needs it:

```bash
sudo tee /etc/apt/apt.conf.d/52unattended-upgrades-local <<'EOF'
// Local overrides for unattended-upgrades.
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF
```

Verify the timer is running:

```bash
systemctl list-timers apt-daily-upgrade.timer
```

You should see a `Next` value within 24 h.

## 7. Sanity checks before continuing

```bash
free -h            # confirm RAM matches plan
df -h /            # > 50 GB free expected on a fresh 80 GB image
ss -tlnp           # only sshd should be listening on 0.0.0.0
journalctl -p err -b --no-pager | tail -20   # any boot errors?
```

Move to `02-security-hardening.md`.
