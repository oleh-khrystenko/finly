# 07 — Monitoring

Goal: notice an outage before customers do, and have the right commands ready when it happens. A single VPS doesn't justify a full Grafana stack — outsource uptime checks and use the boring built-in tools for everything else.

## 1. Outside-in uptime checks (highest leverage)

Pick one. All have free tiers.

| Service                                                 | Notes                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [UptimeRobot](https://uptimerobot.com/)                 | Easy, dumb, reliable. 50 monitors free, 5-min interval.                      |
| [Healthchecks.io](https://healthchecks.io/)             | Best for _cron monitoring_ (alerts when a job fails to run). 20 checks free. |
| [BetterStack / Better Uptime](https://betterstack.com/) | Nicer UI, on-call rotations on paid tier.                                    |

Add at minimum:

- HTTPS check on `https://<DOMAIN>/` — alert on non-200 or > 5 s.
- HTTPS check on the app's `/api/health` if exposed — same.
- A "passive" Healthchecks.io ping in the nightly backup cron (see `08-backups.md`) — alerts when the backup fails to run.

These run from outside your VPS, so they catch the failure modes your local checks can't (DNS, Cloudflare, ISP).

## 2. Built-in commands you'll actually use

**Is the site up?**

```bash
curl -sS -o /dev/null -w "%{http_code} ttfb=%{time_starttransfer}s total=%{time_total}s\n" -L --max-time 8 https://<DOMAIN>/
```

**Containers healthy?**

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker compose -f /opt/<PROJECT>/compose.yaml ps
```

**Recent app logs?**

```bash
docker compose -f /opt/<PROJECT>/compose.yaml logs --tail=200 -f
docker logs -f --tail=200 <PROJECT>-api-1
```

**Caddy access log (per-request)?**

```bash
sudo tail -f /var/log/caddy/<PROJECT>.log | jq -c '{ts, status, request: .request.uri, ms: (.duration*1000|round)}'
```

**System errors (last hour)?**

```bash
sudo journalctl -p err --since '1 hour ago' --no-pager
```

**Resource snapshot?**

```bash
htop                     # interactive
top -bn1 | head -20      # batch
free -h
df -h /
docker stats --no-stream
```

**fail2ban activity?**

```bash
sudo fail2ban-client status sshd
sudo fail2ban-client banned
```

## 3. ctop — top for containers

Useful enough to install:

```bash
sudo wget -O /usr/local/bin/ctop https://github.com/bcicen/ctop/releases/download/v0.7.7/ctop-0.7.7-linux-amd64
sudo chmod +x /usr/local/bin/ctop
ctop
```

## 4. Optional: Netdata (single-node, lightweight)

If you want pretty graphs without standing up a separate metrics box:

```bash
bash <(curl -Ss https://my-netdata.io/kickstart.sh) --dont-wait --disable-telemetry
```

Netdata listens on `127.0.0.1:19999` by default — bind to localhost only. Reach it via `ssh -L 19999:127.0.0.1:19999 <USER>@<IP>` then open `http://127.0.0.1:19999/`. Don't expose it publicly (no auth by default).

To save costs and noise on a tiny VPS, this is optional. The outside-in uptime check + the built-in commands above cover 90 % of incidents.

## 5. Logs that matter

| Path                           | What's there                                                          |
| ------------------------------ | --------------------------------------------------------------------- |
| `/var/log/caddy/<PROJECT>.log` | One line per HTTP request (Caddy structured JSON). Rotated 10 MB × 5. |
| `journalctl -u caddy`          | Caddy startup / config errors.                                        |
| `journalctl -u docker`         | Docker daemon events; OOM kills.                                      |
| `docker logs <name>`           | App stdout/stderr per container.                                      |
| `/var/log/auth.log`            | SSH attempts (mostly fail2ban-actioned brute force noise).            |
| `/var/log/cyanship-backup.log` | Output of the nightly backup script (see `08-backups.md`).            |
| `journalctl -k --since today`  | Kernel messages, including `[UFW BLOCK]` (firewall drops).            |

## 6. Verification

After bringing up the stack:

```bash
# all services
systemctl is-active caddy docker fail2ban ufw unattended-upgrades

# all containers
docker ps --format "table {{.Names}}\t{{.Status}}"

# end-to-end
curl -sS -o /dev/null -w "https://<DOMAIN> → %{http_code} %{time_starttransfer}s\n" -L https://<DOMAIN>/

# headers
curl -sI https://<DOMAIN>/ | grep -iE 'strict-transport|x-frame|content-encoding'
```

Move to `08-backups.md`.
