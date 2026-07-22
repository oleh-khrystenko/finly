# 02 — Security hardening

Goal: shrink the attack surface to "key-only SSH on 22 + Caddy on 80/443". Default-deny everything else. Fail2ban absorbs brute force noise.

## 1. Non-root sudo user

If your provider gave you only `root`, create the deploy user:

```bash
sudo adduser --disabled-password --gecos "" <USER>
sudo usermod -aG sudo <USER>
sudo install -d -m 700 -o <USER> -g <USER> /home/<USER>/.ssh
echo "<your-ssh-pubkey>" | sudo tee /home/<USER>/.ssh/authorized_keys
sudo chmod 600 /home/<USER>/.ssh/authorized_keys
sudo chown <USER>:<USER> /home/<USER>/.ssh/authorized_keys
```

Test SSH as `<USER>` from a second terminal (`ssh <USER>@<IP>`). Only proceed once that works.

If the provider already created `ubuntu` with NOPASSWD sudo (cloud-init default), keep that — works fine.

## 2. Lock down sshd

The drop-in mechanism is the right way to override the system default — never edit `/etc/ssh/sshd_config` directly (apt upgrades will clobber it).

```bash
sudo tee /etc/ssh/sshd_config.d/01-hardening.conf <<'EOF'
# Local hardening overrides. Loaded before 50-cloud-init.conf and 60-cloudimg-settings.conf
# (sshd uses the first occurrence of each directive).
PermitRootLogin no
MaxAuthTries 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
EOF

sudo sshd -t                       # syntax check; must be silent
sudo systemctl reload ssh
```

**Critical:** keep your existing SSH session open. Open a _second_ terminal and confirm you can still log in. If you can, only then close the first.

Verify directives are active:

```bash
sudo sshd -T | grep -E '^(permitrootlogin|maxauthtries|logingracetime|clientaliveinterval|clientalivecountmax)'
```

Expected:

```
permitrootlogin no
maxauthtries 3
logingracetime 30
clientaliveinterval 300
clientalivecountmax 2
```

## 3. UFW firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp     comment 'SSH'
sudo ufw allow 80/tcp     comment 'HTTP (Caddy)'
sudo ufw allow 443/tcp    comment 'HTTPS (Caddy)'
sudo ufw --force enable
sudo ufw status verbose
```

If you ever change the SSH port, **add the new rule before** removing 22/tcp.

Note: Docker bypasses UFW by default for published ports (it inserts its own iptables/nftables rules in the `DOCKER` chain). On this stack we only publish to `127.0.0.1`, so it doesn't matter — but if you later expose container ports on `0.0.0.0`, you must lock them down inside the compose file (`ports: - "127.0.0.1:PORT:PORT"`) or use [`ufw-docker`](https://github.com/chaifeng/ufw-docker).

## 4. fail2ban

`apt install fail2ban` from step 01 already enables the `sshd` jail with default banaction `ufw`. Verify:

```bash
sudo systemctl status fail2ban --no-pager
sudo fail2ban-client status sshd
```

Optional but recommended: add a `recidive` jail that bans repeat offenders for a week, and bump the default ban to 1h:

```bash
sudo tee /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd

[sshd]
enabled  = true

[recidive]
enabled  = true
bantime  = 1w
findtime = 1d
maxretry = 5
EOF

sudo systemctl restart fail2ban
sudo fail2ban-client status
```

## 5. Secrets / config file permissions

The application `.env` will hold every API key the app uses (Stripe, JWT secrets, etc.). It must be `0600` and owned by the user that owns the app directory:

```bash
sudo chmod 600 /opt/<PROJECT>/.env
sudo chown <USER>:<USER> /opt/<PROJECT>/.env
ls -la /opt/<PROJECT>/.env       # -rw------- 1 <USER> <USER>
```

Same rule for any `*.env`, `*.key`, TLS private keys, and restic password files. World-readable secrets are the most common mistake — `find` can audit:

```bash
sudo find /opt /etc/caddy /etc/restic -type f \
    \( -name '*.env' -o -name '*.key' -o -name '*-key.pem' -o -name 'origin-key.pem' \) \
    -not -perm 600 -not -perm 400 -ls
```

Empty output is what you want.

## 6. Sudo policy sanity

Confirm only your deploy user has sudo:

```bash
getent group sudo
```

Should list only `<USER>` (cloud-init may also list `ubuntu` — fine). Remove anything unexpected with `sudo gpasswd -d <name> sudo`.

## 7. Verification

```bash
# SSH config
sudo sshd -T | grep -E 'passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication'
# expected: passwordauthentication no, kbdinteractiveauthentication no, pubkeyauthentication yes

# Firewall
sudo ufw status

# fail2ban
sudo fail2ban-client status sshd

# Listening ports — should be only 22, 53 (systemd-resolved, localhost), nothing else yet
ss -tlnp
```

Move to `03-swap-and-tuning.md`.
