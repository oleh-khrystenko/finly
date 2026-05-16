# 06 — Caddy + Cloudflare

Goal: Caddy on the host, Cloudflare in front. TLS terminated by Caddy with a Cloudflare *Origin Certificate* (15 years, no Let's Encrypt rate limits, no LE renewal logic to babysit). Cloudflare proxy mode = "Full (strict)".

## 1. DNS in Cloudflare

In the Cloudflare dashboard for `<DOMAIN>`:

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | @ | `<IPV4>` | proxied (orange cloud) |
| AAAA | @ | `<IPV6>` | proxied |
| CNAME | www | `<DOMAIN>` | proxied |

SSL/TLS → Overview → set to **Full (strict)**. `Always Use HTTPS` ON, `Automatic HTTPS Rewrites` ON, `Min TLS Version` 1.2.

## 2. Cloudflare Origin Certificate (issued once, valid 15 years)

In the Cloudflare dashboard: **SSL/TLS → Origin Server → Create Certificate**.

- Hostnames: `<DOMAIN>` and `*.<DOMAIN>`
- Validity: **15 years**
- Click "Create"

Two text blobs are shown (`origin.pem` and `origin-key.pem`). Copy them now — `origin-key.pem` is shown only once.

On the server:

```bash
sudo install -d -m 750 -o caddy -g caddy /etc/caddy/tls
sudo install -m 600 -o caddy -g caddy /dev/null /etc/caddy/tls/origin.pem
sudo install -m 600 -o caddy -g caddy /dev/null /etc/caddy/tls/origin-key.pem

sudo vim /etc/caddy/tls/origin.pem        # paste the cert (BEGIN CERTIFICATE … END)
sudo vim /etc/caddy/tls/origin-key.pem    # paste the private key (BEGIN PRIVATE KEY …)

# verify the pair matches
sudo bash -c 'diff <(openssl x509 -in /etc/caddy/tls/origin.pem -pubkey -noout) \
                   <(openssl pkey -in /etc/caddy/tls/origin-key.pem -pubout)'
# empty diff = OK

# verify validity
sudo openssl x509 -in /etc/caddy/tls/origin.pem -noout -dates -subject -issuer
```

## 3. Install Caddy

```bash
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
    sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
    sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt -y install caddy

sudo systemctl status caddy --no-pager   # active+enabled by default
caddy version
```

## 4. Caddyfile

The cleanest layout: keep the canonical Caddyfile **inside the repo** (`/opt/<PROJECT>/Caddyfile`) so it's versioned, and symlink `/etc/caddy/Caddyfile → /opt/<PROJECT>/Caddyfile` so Caddy reads from the repo. Any `git pull` automatically updates the proxy config; one `caddy reload` applies it.

Repo file (`/opt/<PROJECT>/Caddyfile`):

```caddy
<DOMAIN> {
    reverse_proxy 127.0.0.1:3000

    tls /etc/caddy/tls/origin.pem /etc/caddy/tls/origin-key.pem

    encode zstd gzip

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(self)"
        Cross-Origin-Opener-Policy same-origin
        -Server
    }

    log {
        output file /var/log/caddy/<PROJECT>.log {
            roll_size 10mb
            roll_keep 5
        }
    }
}

# Optional: redirect www → apex
www.<DOMAIN> {
    redir https://<DOMAIN>{uri} permanent
    tls /etc/caddy/tls/origin.pem /etc/caddy/tls/origin-key.pem
}
```

Wire up the symlink (after committing the repo file):

```bash
sudo cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%F)   # safety net
sudo rm /etc/caddy/Caddyfile
sudo ln -s /opt/<PROJECT>/Caddyfile /etc/caddy/Caddyfile

sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
systemctl is-active caddy
```

If `caddy validate` errors, do **not** reload — fix the file first. Restore from `.bak` and try again.

Make sure caddy can read the repo file (the file ships with `0664` ubuntu:ubuntu by default, which is fine; the parent `/opt/<PROJECT>/` must be at least `0755`):

```bash
ls -la /opt/<PROJECT>/Caddyfile
sudo -u caddy test -r /opt/<PROJECT>/Caddyfile && echo OK
```

## 5. Why these headers

- **HSTS** — pin HTTPS for a year. Cloudflare in front does not auto-send HSTS; this is the source.
- **`X-Frame-Options: DENY`** — the legacy clickjacking protection. CSP `frame-ancestors` superseded it; ship both for old browsers.
- **`Referrer-Policy: strict-origin-when-cross-origin`** — modern default. Stops leaking full URLs to third parties.
- **`Permissions-Policy`** — disable browser APIs the app doesn't use (camera, mic, geolocation). Whitelist what you need (`payment=(self)` for Stripe.js).
- **`Cross-Origin-Opener-Policy: same-origin`** — opt into `crossOriginIsolated` posture (needed for some workers). Safe default.
- **`-Server`** — strip the server identity so the response no longer says "Server: Caddy".

`Content-Security-Policy` is intentionally absent — a real CSP needs to be coordinated with the app (Next.js inline scripts, hash/nonce strategy). Add it after measuring with `Content-Security-Policy-Report-Only` first.

## 6. Verification

```bash
curl -sS -o /dev/null -w "%{http_code} ttfb=%{time_starttransfer}s\n" -L --max-time 8 https://<DOMAIN>/
curl -sI https://<DOMAIN>/ | grep -iE 'strict-transport|x-frame|x-content|content-encoding|server'

# direct origin (bypassing Cloudflare) — should 200 if you allow your laptop IP, otherwise 0
curl -sk --resolve "<DOMAIN>:443:<IPV4>" https://<DOMAIN>/ -o /dev/null -w "%{http_code}\n"
```

Expected:
- HTTPS via Cloudflare returns `200`.
- HSTS header present, `X-Frame-Options: DENY`, `Content-Encoding: zstd|gzip|br` (depending on client), no `Server: Caddy`.

## 7. Cloudflare WAF / firewall (optional but cheap)

In Cloudflare → Security → WAF:
- Enable **OWASP managed ruleset** (free plan).
- Enable **Cloudflare managed ruleset** (paid plans).
- Bot Fight Mode → ON.
- Rate limiting rule for `/api/*` (e.g. 60 req/min/IP) if your stack doesn't already throttle.

These are belt-and-suspenders to the app's own rate-limit logic.

Move to `07-monitoring.md`.
