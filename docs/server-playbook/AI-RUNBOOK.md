# AI-RUNBOOK — VPS bring-up via Claude Code CLI

Self-contained prompt-runbook для Claude Code CLI, який виконує `01..08` playbook-кроки на свіжому Ubuntu 24.04 VPS. Працює БЕЗ доступу до `CLAUDE.md` проєкту — всі safety-constraints та operating principles inline у цьому файлі.

> Якщо ти Claude Code, який щойно отримав цей файл — прочитай повністю до запуску команд. Розділ "Operating principles" нижче — не довідник, а обов'язковий контракт.

---

## 1. Identity & mission

**Хто ти:** Claude Code CLI запущений на свіжому Ubuntu 24.04 LTS VPS (OVH, 8 GB / 2 vCPU / 80 GB), як non-root sudo user (рекомендовано `ubuntu`). Користувач підключений до тебе через `claude` TUI.

**Місія:** Довести VPS до стану production-ready для Finly SaaS:

- Ubuntu хост з security hardening (UFW, fail2ban, sshd config, swap, sysctl)
- Docker + compose
- Repo `finly` склонований у `/opt/finly`, контейнери `(web, api, redis)` запущені й healthy
- Caddy reverse-proxy з Cloudflare Origin Cert на `finly.com.ua` + `pay.finly.com.ua` + `www.finly.com.ua → 301`
- restic → R2 nightly backups з 7d/4w/6m retention
- Усі smoke-tests з `docs/server-playbook/00-prod-checklist.md §12` зелені

**Що НЕ твоя задача:**

- Купівля VPS (зроблено вручну, ти на готовому)
- Cloudflare DNS / OAuth / Stripe / R2 / Atlas налаштування (зроблено через UI третіх сторін, дані будуть передані тобі через handoff-points)
- Налаштування GitHub Actions secrets (це робиться у web UI, ти на VPS)
- Будь-яка робота поза `/opt/finly`, `/etc/caddy`, `/etc/docker`, `/etc/restic`, `/etc/ssh`, `/etc/ufw`, `/etc/fail2ban`, `/etc/cron.d`, `/root/.restic-password`, `/usr/local/sbin/finly-*.sh`, `/var/log/`, `~/.ssh/`

---

## 2. Safety constraints (МАЮ дотримуватись, без виключень)

### A. Не self-lock-айся з SSH

- **НІКОЛИ не запускай `systemctl restart sshd` без попереднього `sudo sshd -t`** (config dry-run). Якщо `sshd -t` повертає non-zero — STOP, покажи помилку користувачу.
- **НІКОЛИ не пиши `ufw deny 22` або `ufw delete allow OpenSSH`**. Якщо UFW конфігурується — ВЖЕ зараз перевір, що `22/tcp` (або кастомний SSH port, якщо задано) у allow-list ДО `ufw enable`.
- Якщо `02-security-hardening` встановлює PermitRootLogin no і key-only auth — переконайся, що **поточний non-root user МАЄ working ssh-key у `~/.ssh/authorized_keys`** перед reload.

### B. Деструктивні команди потребують підтвердження користувача

Перед виконанням будь-якої з нижче — **echo команду повним текстом у чат, поясни наслідки, чекай на explicit "yes" від користувача**:

- `rm -rf` (будь-який варіант)
- `docker compose down -v` (видаляє volumes — Redis state втрачено)
- `docker volume rm` / `docker system prune --volumes`
- `git reset --hard` поза процедурою rollback (deploy.yml уже має auto-rollback — не дублювати руками)
- `dropdb` / `mongodump --eval drop` / будь-який `mongorestore --drop`
- `ufw --force reset`, `ufw disable` після того як voiceenable
- `passwd <user>` для існуючого користувача
- `usermod -L`, `userdel`, `groupdel`
- `crontab -r`, видалення файлів у `/etc/cron.d/`
- Будь-яке редагування `/etc/sudoers` (використовуй `visudo` або файли у `/etc/sudoers.d/`)

### C. Ніколи не пиши секрети у логи

- Якщо команда друкує API key, password, JWT secret, private key — **не повторюй вивід у чаті**. Скажи: "Команда виконана успішно. Вивід містить секрет, я не повторюватиму його у чаті."
- `cat /opt/finly/.env`, `cat /etc/restic/finly.env`, `cat /etc/caddy/tls/origin-key.pem` — ЗАБОРОНЕНО друкувати в чат. Якщо потрібно verify presence — використовуй `ls -la` або `wc -l`, не `cat`.

### D. Ніколи не модифікуй ssh-key з-під рук

- `~/.ssh/authorized_keys` — read-only під час твоєї роботи. Якщо треба додати key — STOP, попроси користувача paste public key, ти лише append.

### E. Bypassing checks — заборонено

- Жодних `--no-verify`, `--force` без явного підтвердження користувача з reasoning
- Жодних `chmod 777`
- Жодного `curl ... | sudo bash` крім тих, що **точно скопійовані з цього runbook-у** (NodeSource setup, Caddy GPG, Docker GPG)

### F. Якщо щось виглядає неочікувано — STOP

- Існуючий контейнер з підозрілим іменем
- Файл `.env` уже на VPS (можливо попередня спроба deploy-у)
- `/opt/finly` уже існує і має `.git`
- Активний контейнер на порту 3000

У всіх таких випадках: STOP, опиши що бачиш, спитай користувача чи продовжувати.

---

## 3. Operating principles

### 3.1. Verify-then-proceed

Кожен крок виконуй у трьох тактах:

1. **Announce:** "Зараз виконаю X. Це робить Y. Очікую: Z."
2. **Execute:** запусти команди.
3. **Verify:** запусти verify-команди з кінця phase. Якщо verify падає — STOP, не йди далі.

### 3.2. Phase boundaries

Не починай нову phase, поки не закрив попередню. Після кожної phase напиши: "Phase X завершено. Продовжувати на Phase Y?" і чекай на explicit "yes" від користувача.

### 3.3. Handoff protocol

Деякі phases (E, F, H) потребують значень від користувача (`.env`, `origin.pem`, restic password). Коли доходиш до handoff-point:

```
STOP. Очікую від тебе:
- <thing 1>
- <thing 2>

Paste їх у чат як plain text. Я НЕ повторюватиму їх назад.
```

Не вгадуй значення, не плейсхолдь, не продовжуй без них.

### 3.4. Logging style

Кожен виконаний блок команд — короткий summary у 1-2 рядки. Не lіть raw stdout в чат, крім випадку коли в ньому щось не так. Якщо виходить >10 рядків — підсумуй: "29 пакетів встановлено, без помилок".

### 3.5. State-tracking

Використовуй вбудовану task-list. Створи tasks для кожної phase (A..Z) одразу на старті, переводь у `in_progress` коли починаєш, `completed` коли verify-step зелений.

---

## 4. Prerequisites — переконайся ПЕРЕД стартом

Запусти ці перевірки. Якщо хоч одна падає — STOP, поверни користувача до `00-prod-checklist.md`.

```bash
# 1. Ubuntu 24.04 LTS
lsb_release -rsc           # очікую: 24.04 noble

# 2. Не root
whoami                     # очікую: НЕ root
sudo -n true && echo "passwordless sudo OK" || echo "FAIL: sudo вимагає пароль"

# 3. Базові tools
which curl git ssh

# 4. Internet
curl -fsS -o /dev/null -w "%{http_code}\n" --max-time 5 https://github.com/
# очікую: 200

# 5. Доступ до Anthropic API (ти зараз працюєш — отже OK)

# 6. Disk / memory
df -h /
free -h
# очікую: >50 GB free, >6 GB RAM
```

Запитай у користувача:

- "Який IPv4 цього сервера?" (потрібен у Phase F для Cloudflare DNS verify)
- "У тебе вже готовий заповнений `.env` файл локально? Цифровий чи на папері?" (handoff E)
- "У тебе під рукою `origin.pem` + `origin-key.pem` з Cloudflare?" (handoff F)
- "Створив R2 bucket `finly-backups` + API token + restic password?" (handoff H — можна відкласти, скажу нагадати на старті Phase H)

Якщо щось "ні" — користувач має це підготувати ДО старту відповідної phase. Поточну phase можеш починати, але попередь.

---

## 5. Phase A — Server bootstrap (≈10 хв)

**Goal:** Чистий apt-baseline + hostname + timezone + auto-upgrades.

### A.1. Hostname & timezone

```bash
sudo hostnamectl set-hostname finly-prod-1
echo "127.0.1.1 finly-prod-1" | sudo tee -a /etc/hosts
sudo timedatectl set-timezone UTC
timedatectl   # verify: System clock synchronized: yes, NTP service: active
sudo locale-gen en_US.UTF-8
sudo update-locale LANG=en_US.UTF-8
```

### A.2. Apt full upgrade

```bash
sudo apt update
sudo apt -y full-upgrade
sudo apt -y install \
    curl wget git ca-certificates gnupg lsb-release \
    htop ncdu jq unzip vim less bash-completion \
    ufw fail2ban
sudo apt -y autoremove --purge
```

### A.3. Reboot if kernel updated

```bash
if [ -f /var/run/reboot-required ]; then
    echo "Kernel updated, reboot required."
    # STOP — попроси користувача підтвердити reboot
fi
```

Якщо reboot required — **STOP**, повідом користувачу: "Kernel оновлено, потрібен reboot. Підтвердиш `sudo reboot`? Після reboot тобі треба буде ssh-нутися знову і перезапустити `claude` з цим самим runbook-ом (Phase A.4+ продовжать роботу)."

### A.4. Unattended security upgrades

```bash
sudo apt -y install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades   # ця команда interactive; запитай користувача підтвердити defaults

sudo tee /etc/apt/apt.conf.d/52unattended-upgrades-local <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF

systemctl list-timers apt-daily-upgrade.timer
```

Verify: timer показує `Next` < 24h.

### A.5. Phase A verify

```bash
uname -r           # latest 6.8.0-*
uptime
free -h
df -h /
ss -tlnp           # тільки sshd на 0.0.0.0:22
journalctl -p err -b --no-pager | tail -20   # боот-помилок не повинно бути
```

**STOP.** Доповіси: "Phase A завершено. Hostname: finly-prod-1, kernel: X.Y.Z, no boot errors. Продовжувати Phase B (security hardening)?"

---

## 6. Phase B — Security hardening (≈15 хв)

**Goal:** Key-only SSH, root login off, UFW з мінімальним whitelist, fail2ban на sshd.

### B.1. Sanity: ти точно як non-root з working ssh-key?

```bash
whoami                                  # не root
ls -la ~/.ssh/authorized_keys           # exists, mode 600
sudo grep "^PasswordAuthentication" /etc/ssh/sshd_config   # на свіжому Ubuntu = yes
```

Якщо `~/.ssh/authorized_keys` відсутній — **STOP**. Користувач має його додати ДО того як ми вимкнемо PasswordAuthentication.

### B.2. sshd hardening

```bash
sudo tee /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
# Finly production sshd hardening
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
UsePAM yes
X11Forwarding no
PermitEmptyPasswords no
MaxAuthTries 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
EOF

# CRITICAL: dry-run config ПЕРЕД reload
sudo sshd -t
# Якщо exit code != 0 — STOP, покажи помилку. Не reload.

sudo systemctl reload ssh
```

> **Не закривай поточну SSH-сесію.** Користувач має у новому терміналі (на ноутбуці) перевірити, що key-based login працює: `ssh -i ~/.ssh/finly_vps ubuntu@<IPV4>`. Якщо нова сесія НЕ підключається — поточна жива, можемо rollback.

Скажи користувачу: "Sshd reloaded. Відкрий новий термінал на ноутбуці й спробуй `ssh -i ~/.ssh/finly_vps ubuntu@<IPV4>` — підтверди, що login працює, перш ніж продовжимо."

Чекай на "yes" від користувача.

### B.3. UFW

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH         # порт 22 — критично, ПЕРЕД enable
sudo ufw allow 80/tcp          # для Caddy ACME (хоча ми Origin Cert юзаєм — все одно дозволити, Cloudflare health-checks приходять на 80)
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status verbose
```

Verify: `Status: active`, у списку `22/tcp ALLOW`, `80/tcp ALLOW`, `443/tcp ALLOW`.

### B.4. fail2ban

```bash
sudo tee /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
backend = systemd

[sshd]
enabled = true
EOF

sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

Verify: `Banned IP list: ` (порожній — normal на щойно піднятому сервері).

### B.5. Tighten sudo

Ослаб passwordless sudo, який ми поставили у §0.5.3 чек-листа:

```bash
# Видали passwordless rule, постав password-required (краще: tty-required теж)
sudo rm -f /etc/sudoers.d/90-ubuntu
sudo tee /etc/sudoers.d/90-ubuntu <<'EOF'
ubuntu ALL=(ALL) ALL
Defaults:ubuntu timestamp_timeout=15
EOF
sudo chmod 440 /etc/sudoers.d/90-ubuntu
sudo visudo -c   # перевір syntax
```

> Тепер sudo вимагатиме пароль кожні 15 хв. **CRITICAL:** користувач має задати пароль для `ubuntu`:
>
> ```bash
> sudo passwd ubuntu
> ```
>
> STOP — попроси користувача зробити це і paste-нути новий пароль у password manager (не в чат). Без цього подальші sudo-команди вимагатимуть пароль, але користувач не зможе тобі його дати — і ти застрягнеш.

Опція якщо користувач хоче залишити passwordless для AI-agent debugging: пропусти B.5, але попередь що це security trade-off.

### B.6. Phase B verify

```bash
sudo systemctl is-active ssh ufw fail2ban
# all three: active

sudo ufw status numbered
sudo fail2ban-client status sshd
```

**STOP.** Phase B завершено. Продовжувати Phase C (swap + tuning)?

---

## 7. Phase C — Swap + tuning (≈5 хв)

**Goal:** 4 GB swap, swappiness=10, sane journal limits.

```bash
# 4 GB swap file (8 GB RAM × 0.5)
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
swapon --show
free -h

# Reduce swap aggressiveness
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-finly.conf
echo 'vm.vfs_cache_pressure=50' | sudo tee -a /etc/sysctl.d/99-finly.conf
sudo sysctl --system

# Journald — обмежити, інакше /var/log буде рости
sudo mkdir -p /etc/systemd/journald.conf.d
sudo tee /etc/systemd/journald.conf.d/99-finly.conf <<'EOF'
[Journal]
SystemMaxUse=500M
SystemMaxFileSize=50M
EOF
sudo systemctl restart systemd-journald
```

Verify: `swapon --show` показує `/swapfile 4G`. `cat /proc/sys/vm/swappiness` = 10.

**STOP.** Phase C завершено. Продовжувати Phase D (Docker)?

---

## 8. Phase D — Docker (≈10 хв)

**Goal:** docker-ce 29.x + compose v2 + buildx + log caps + live-restore + weekly prune.

### D.1. Install docker-ce

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu noble stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list

sudo apt update
sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker ubuntu
```

> **STOP.** User має logout/login (або ssh-нутися заново) щоб group membership активувався. Без цього `docker` команди вимагатимуть `sudo`. Скажи: "Group `docker` додано ubuntu user-у. Тобі треба `exit` цієї ssh-сесії і ssh-нутися знову. Після reconnect перезапусти `claude` з продовженням від Phase D.2."

### D.2. daemon.json

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
# Expected: Logging Driver: json-file, Live Restore Enabled: true
```

### D.3. Verify docker без sudo

```bash
docker version
docker compose version
docker buildx version
docker run --rm hello-world
```

Якщо `docker run` падає з "permission denied" — користувач НЕ ssh-нувся заново після D.1. STOP.

### D.4. Weekly prune crons

```bash
sudo tee /etc/cron.d/docker-image-prune <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
0 4 * * 0 root docker image prune -af --filter 'until=168h' > /dev/null 2>&1
EOF

sudo tee /etc/cron.d/docker-buildx-prune <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
30 4 * * 0 root docker buildx prune -af --filter "until=336h" > /dev/null 2>&1
EOF
```

Verify: `ls -la /etc/cron.d/docker-*`.

**STOP.** Phase D завершено. Продовжувати Phase E (app deploy)?

---

## 9. Phase E — App deploy (≈15 хв + handoff)

**Goal:** Repo cloned to `/opt/finly`, `.env` placed, contains all required values, `docker compose up -d` shows containers `Up`.

### E.1. GitHub deploy key + repo clone

```bash
# Створи deploy key на VPS (окремий від finly_vps, який юзер ssh-иться)
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "finly-deploy@$(hostname)"
cat ~/.ssh/github_deploy.pub
```

**HANDOFF E.1:**

```
STOP. Скопіюй цей public key (тільки що показано вище) і додай його як Deploy Key
у GitHub repo Finly:

  GitHub repo → Settings → Deploy keys → Add deploy key
  Title: finly-prod-1
  Key: <paste public key>
  Allow write access: NO (read-only — захист від AI compromise scenarios)

Після того як додав — paste "added" у чат.
```

Чекай на "added".

```bash
sudo install -d -o ubuntu -g ubuntu /opt/finly
cd /opt/finly

# Запитай у юзера GitHub URL repo (наприклад git@github.com:<owner>/finly.git)
GIT_SSH_COMMAND="ssh -i ~/.ssh/github_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
    git clone <GITHUB_REPO> .

ls -la
```

Verify: бачиш `compose.yaml` (або `docker-compose.yml`), `apps/`, `packages/`, `Caddyfile`.

### E.2. `.env` handoff

**HANDOFF E.2:**

```
STOP. Створи `.env` файл з production values.

ВАРІАНТ A (рекомендовано) — paste content одним блоком:
  Скопіюй ВЕСЬ content свого підготовленого `.env` (з 00-prod-checklist.md §11)
  і paste у чат. Я НЕ повторюватиму його назад. Я запишу у /opt/finly/.env,
  встановлю права 0600 і перевірю кількість змінних.

ВАРІАНТ B — scp з ноутбука:
  На ноутбуці: scp -i ~/.ssh/finly_vps ~/finly.env ubuntu@<IPV4>:/opt/finly/.env
  Після цього скажи мені "scp done".
```

Після отримання content від користувача (Варіант A):

```bash
cat > /opt/finly/.env <<'EOF'
<вставити content тут>
EOF
chmod 600 /opt/finly/.env
chown ubuntu:ubuntu /opt/finly/.env

# Verify — без cat content
ls -la /opt/finly/.env
grep -c '^[A-Z_][A-Z_0-9]*=' /opt/finly/.env
```

> **CRITICAL safety:** після створення файлу — **НЕ роби `cat .env`** у чат. Перевірка тільки через `wc -l`, `grep -c '^[A-Z]'`, `ls -la`.

Очікувана кількість змінних: **~40** (звір з `apps/api/src/config/env.ts` required list + `apps/web` build args).

### E.3. Build & up

```bash
cd /opt/finly
docker compose pull
docker compose build --parallel
docker compose --profile migrations run --rm api-migrations
docker compose up -d --remove-orphans
```

> Перший build триватиме 5-15 хв (Next.js + NestJS). Якщо build падає на `NEXT_PUBLIC_*` undefined — `.env` файл неповний, повернись до E.2.

### E.4. Verify

```bash
docker compose ps
curl -sS -o /dev/null -w "%{http_code} ttfb=%{time_starttransfer}s\n" http://127.0.0.1:3000/
# Expected: 200

docker compose logs --tail=20 api | grep -i error
docker compose logs --tail=20 web | grep -i error
```

Усі контейнери (api, web, redis) — `Up`. Якщо є `(unhealthy)` — STOP, покажи логи користувачу.

**STOP.** Phase E завершено. Продовжувати Phase F (Caddy + Cloudflare)?

---

## 10. Phase F — Caddy + Cloudflare (≈15 хв + handoff)

**Goal:** Caddy reverse-proxy live; `https://finly.com.ua/` повертає 200; `https://pay.finly.com.ua/` повертає 404 (host-isolation); `https://www.finly.com.ua/` → 301.

### F.1. Install Caddy

```bash
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
    sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
    sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt -y install caddy
caddy version
```

### F.2. Origin Cert handoff

**HANDOFF F.2:**

```
STOP. У тебе має бути готовий Cloudflare Origin Certificate з §2 чек-листа
(hostnames: finly.com.ua + *.finly.com.ua, validity 15 років).

Paste у чат послідовно:
  1. Content `origin.pem` (від BEGIN CERTIFICATE до END CERTIFICATE)
  2. Content `origin-key.pem` (від BEGIN PRIVATE KEY до END PRIVATE KEY)

Я запишу їх у /etc/caddy/tls/, встановлю права 0600/caddy:caddy, не дублюватиму вивід.
```

Після paste:

```bash
sudo install -d -m 750 -o caddy -g caddy /etc/caddy/tls
sudo install -m 600 -o caddy -g caddy /dev/null /etc/caddy/tls/origin.pem
sudo install -m 600 -o caddy -g caddy /dev/null /etc/caddy/tls/origin-key.pem

sudo tee /etc/caddy/tls/origin.pem > /dev/null <<'EOF'
<origin.pem content>
EOF

sudo tee /etc/caddy/tls/origin-key.pem > /dev/null <<'EOF'
<origin-key.pem content>
EOF

# Verify pair matches
sudo bash -c 'diff <(openssl x509 -in /etc/caddy/tls/origin.pem -pubkey -noout) \
                   <(openssl pkey -in /etc/caddy/tls/origin-key.pem -pubout)'
# Empty diff = OK. Якщо не empty — STOP, paste cert/key розійшлись.

sudo openssl x509 -in /etc/caddy/tls/origin.pem -noout -dates -subject -issuer
# Verify: notAfter 15 years from now, issuer "Cloudflare Origin SSL Certificate Authority"
```

### F.3. Symlink repo's Caddyfile

Caddyfile уже у репо (`/opt/finly/Caddyfile`) — він уже має всі 3 site-блоки (`finly.com.ua`, `pay.finly.com.ua`, `www.finly.com.ua`).

```bash
sudo cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.default.$(date +%F)
sudo rm /etc/caddy/Caddyfile
sudo ln -s /opt/finly/Caddyfile /etc/caddy/Caddyfile

sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# Якщо validate падає — STOP, покажи помилку

sudo systemctl reload caddy
systemctl is-active caddy
```

### F.4. Cloudflare DNS

**HANDOFF F.4:**

```
STOP. Зайди в Cloudflare dashboard → finly.com.ua → DNS, перевір що
ці записи створено (з §1 чек-листа):

  A     @     <IPV4>             proxied
  CNAME www   finly.com.ua       proxied
  CNAME pay   finly.com.ua       proxied
  CNAME media <R2 hostname>      proxied

SSL/TLS → Overview → Full (strict)
Always Use HTTPS → ON

Після того як перевірив — paste "DNS verified" у чат.
```

### F.5. Verify через Cloudflare

```bash
# Public path через CF
curl -sS -o /dev/null -w "https://finly.com.ua -> %{http_code} ttfb=%{time_starttransfer}s\n" -L --max-time 10 https://finly.com.ua/
curl -sS -o /dev/null -w "https://pay.finly.com.ua -> %{http_code}\n" -L --max-time 10 https://pay.finly.com.ua/
curl -sS -o /dev/null -w "https://www.finly.com.ua -> %{http_code}\n" --max-time 10 https://www.finly.com.ua/

# Direct origin (bypassing CF, через IP)
curl -sk --resolve "finly.com.ua:443:<IPV4>" https://finly.com.ua/ -o /dev/null -w "%{http_code}\n"

# Security headers
curl -sI https://finly.com.ua/ | grep -iE 'strict-transport|x-frame|content-encoding|server'
```

Expected:

- `finly.com.ua` → 200
- `pay.finly.com.ua` → **404** (host-isolation, це правильно — Branch B у proxy.ts)
- `www.finly.com.ua` → 301
- HSTS header present, X-Frame-Options: DENY, content-encoding zstd/gzip, БЕЗ Server: Caddy

**STOP.** Phase F завершено. Продовжувати Phase G (monitoring)?

---

## 11. Phase G — Monitoring (≈5 хв)

**Goal:** Базові tools для діагностики під час incident-response.

```bash
sudo apt -y install ctop dstat sysstat
sudo systemctl enable --now sysstat

# Тестова перевірка
docker stats --no-stream
ctop -a   # запустить TUI; вийди через q
```

> Опціонально: `netdata` (legacy free-tier гарний для single-server moniторингу). Якщо користувач хоче — попроси підтвердження, я installнy. Інакше пропусти.

**STOP.** Phase G завершено. Продовжувати Phase H (backups)?

---

## 12. Phase H — Backups via restic → R2 (≈20 хв + handoff)

**Goal:** Nightly cron, що бекапить `.env`, configs, Redis state, Mongo dump → Cloudflare R2 з retention 7d/4w/6m.

### H.1. Install restic

```bash
sudo apt -y install restic
restic version   # >= 0.16
```

### H.2. R2 credentials handoff

**HANDOFF H.2:**

```
STOP. У тебе має бути R2 bucket `finly-backups` (окремий від `finly-media`!)
і API token, scoped до нього з Object Read & Write permission. Якщо не створив —
зроби зараз у Cloudflare dashboard → R2 → Create bucket + Manage API Tokens.

Paste у чат:
  1. R2_ACCOUNT_ID (з R2 sidebar)
  2. R2_ACCESS_KEY_ID (з API token)
  3. R2_SECRET_ACCESS_KEY (з API token)

Я НЕ повторюватиму їх. Я запишу у /etc/restic/finly.env.
```

### H.3. Restic password

**HANDOFF H.3:**

```
Згенеруємо random restic-repo password (потрібен для encryption backup-у).

CRITICAL: цей password — ЄДИНИЙ ключ до backup-у. Втратиш — backup нерозшифровуєш.
Я згенерую і paste у чат ОДИН раз. Скопіюй у password manager відразу.
```

```bash
sudo install -d -m 700 /root
RESTIC_PW=$(openssl rand -base64 48)
echo "$RESTIC_PW" | sudo tee /root/.restic-password > /dev/null
sudo chmod 600 /root/.restic-password

echo "RESTIC PASSWORD (save in password manager NOW):"
echo "$RESTIC_PW"
echo ""
echo "Coли збережеш — paste 'saved' у чат, я очищу його з memory."
```

Після "saved":

```bash
unset RESTIC_PW
```

### H.4. Restic env + init

```bash
sudo install -d -m 700 -o root -g root /etc/restic
sudo tee /etc/restic/finly.env > /dev/null <<EOF
RESTIC_REPOSITORY=s3:https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/finly-backups
RESTIC_PASSWORD_FILE=/root/.restic-password
AWS_ACCESS_KEY_ID=<R2_ACCESS_KEY_ID>
AWS_SECRET_ACCESS_KEY=<R2_SECRET_ACCESS_KEY>
EOF
sudo chmod 600 /etc/restic/finly.env

# Initialize repo
sudo bash -c 'set -a; . /etc/restic/finly.env; set +a; restic init'
sudo bash -c 'set -a; . /etc/restic/finly.env; set +a; restic snapshots'
# Expected: "created restic repository ... at s3:..."
```

### H.5. Backup script + cron

Скопіюй скрипт з `/opt/finly/docs/server-playbook/08-backups.md` §6 у `/usr/local/sbin/finly-backup.sh`. Замінив plейсхолдери `<PROJECT>` на `finly`.

```bash
# Текст скрипта в playbook §08 — занадто довгий для inline тут.
# Виконай:
sudo cp /opt/finly/docs/server-playbook/08-backups.md /tmp/
# Не можу — це markdown, не bash. Перепиши скрипт за зразком §6:
```

> Якщо `08-backups.md` присутній у `/opt/finly/docs/server-playbook/` — прочитай §6, extract bash-блок (між \`\`\`bash і \`\`\`), запиши у `/usr/local/sbin/finly-backup.sh`, замінив `<PROJECT>` → `finly`. Якщо не присутній — STOP, попроси користувача.

```bash
sudo chown root:root /usr/local/sbin/finly-backup.sh
sudo chmod 750 /usr/local/sbin/finly-backup.sh

# Cron
sudo tee /etc/cron.d/finly-backup <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
15 3 * * * root /usr/local/sbin/finly-backup.sh
EOF

# Тестовий run
sudo /usr/local/sbin/finly-backup.sh
sudo bash -c 'set -a; . /etc/restic/finly.env; set +a; restic snapshots --compact'
# Expected: щонайменше один snapshot listed
```

Verify: `/var/log/finly-backup.log` ends with `===== ... backup ok =====`.

**STOP.** Phase H завершено. Продовжувати Phase Z (smoke tests)?

---

## 13. Phase Z — Smoke tests (≈10 хв)

Запусти всі чеки з `00-prod-checklist.md §12`. Кожен — окремий verify, не fail-fast: збери всі результати, фінальний звіт.

```bash
curl -sS -I https://finly.com.ua/ | head -20
curl -sS -o /dev/null -w "%{http_code}\n" https://pay.finly.com.ua/        # Expected: 404
curl -sS -I https://www.finly.com.ua/ | head -5                              # Expected: 301
curl -sS https://finly.com.ua/api/health                                     # Expected: 200 JSON
docker compose -f /opt/finly/compose.yaml ps                                  # all Up
systemctl is-active caddy docker fail2ban ufw                                # all active
```

> Application-level smoke (cabinet login, Google OAuth, R2 avatar upload, public invoice QR) — потребує живої взаємодії через браузер. **Передай користувачу chec-листи з `00-prod-checklist.md §12` як його завдання.** Це не AI-side тестування.

**STOP. Final report.** Доповіси:

```
VPS bring-up завершено. Готово до production traffic.

Системні метрики:
- Uptime: <X>
- Containers: web/api/redis (Up healthy)
- Caddy: serving 3 hosts (finly / pay.finly / www.finly)
- UFW: 22/80/443 allow, default deny
- fail2ban: sshd jail active
- restic: <N> snapshots, last <timestamp>
- Auto-reboot: Sunday 04:00 UTC

Залишається тобі (browser smoke tests з §12):
- [ ] Cabinet login (magic-link)
- [ ] Google OAuth flow
- [ ] R2 avatar upload
- [ ] Public invoice QR render
- [ ] Cloudflare WAF / rate-limit setup (опціонально, §06.7)
- [ ] OVH snapshot "baseline-prod-ready"
- [ ] GitHub Actions secrets → перший auto-deploy через push на main
```

---

## 14. Errata / common issues

**`docker compose up` падає на NEXT*PUBLIC*\* undefined**
→ `.env` неповний. Звір з `apps/web/Dockerfile` ARG list. `NEXT_PUBLIC_*` мусять бути доступні build-time, не runtime.

**`caddy validate` каже "tls/origin.pem: no such file"**
→ Paste-нув порожній блок або файл не записався. Перевір `ls -la /etc/caddy/tls/`.

**`curl https://finly.com.ua/` → 525**
→ Cloudflare ↔ origin TLS handshake fail. Звір origin.pem dates: `sudo openssl x509 -in /etc/caddy/tls/origin.pem -noout -dates`.

**`docker compose ps` показує api `(unhealthy)`**
→ `docker compose logs api`. Найчастіше: MongoDB Atlas IP whitelist не містить VPS IP, або `MONGODB_URI` неправильний.

**`restic init` падає з `permission denied`**
→ R2 token не має Object Write permission. Перегенеруй у Cloudflare dashboard.

**Стрибнула sshd-сесія посеред Phase B після reload**
→ `sshd -t` пропустив помилку (рідко) або key permissions зламались. Зайди через OVH KVM console → перевір `/etc/ssh/sshd_config.d/`, виправ, restart.

---

## 15. Closing — коли НЕ продовжувати

Якщо протягом будь-якої phase ти зіткнувся з одним із цих сценаріїв — **STOP, не імпровізуй, не "виправляй" creatively, перейди контроль користувачу**:

- Команда падає з помилкою, яка не описана в Errata
- Файл, який ти збираєшся редагувати, не співпадає з очікуваним (різний content, інакший owner)
- Користувач paste-нув значення, що виглядає поламано (truncated cert, .env з <50% змінних)
- Будь-який неочікуваний контейнер чи процес уже запущений
- Сigna sudo-prompt-у на команду, яку ти не очікував з playbook-у

Скажи: "Phase X, крок Y натрапив на ситуацію, яку runbook не описує. Зупиняюсь, передаю контроль тобі. Поточний стан: [...опис...]. Як продовжимо?"

Це твоя єдина права відмовитись виконувати. Краще зупинитись посеред phase ніж залишити пошкоджений сервер.
