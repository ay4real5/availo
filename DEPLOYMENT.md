# Availo — Production Deployment Runbook

A step-by-step guide to take Availo from local terminals to a **single Linux
VPS** (DigitalOcean, Hetzner, AWS Lightsail, etc.) using **PM2** (Node + mock
target), **systemd** (scraper), and **Nginx + Let's Encrypt** (domain + TLS).
Postgres is hosted on **Supabase**.

---

## 1. Architecture

| Component | Path | Runtime | Role |
|-----------|------|---------|------|
| **Backend API** | `backend/` | Node 18+ (Express) | Auth, preferences, slots, bookings, email, audit |
| **Scraper worker** | `scraper/` | Python 3.11+ | Long-running poller; discovery + auto-booking |
| **Frontend** | `frontend/` | Vite/React (static) | User dashboard |
| **Database** | `database/schema.sql` | Postgres (Supabase) | Persistence |
| **Mock DVSA site** | `scraper/mock_site/` | Python | Current scraper target until DVSA is wired — **keep private (localhost only)** |

Data flow: scraper → backend (`/api/slots/*`, `/api/scraper/*` with API key) →
Postgres → frontend reads via authenticated user endpoints; backend sends email
via Resend.

---

## 2. Prerequisites (accounts to create)

- **Supabase** project (managed Postgres) — https://supabase.com
- **Resend** account + a verified sending domain — https://resend.com
- **Residential proxy provider** (e.g. Bright Data, Oxylabs, Smartproxy) — for
  the scraper's `PROXY_LIST`.
- *(Optional)* **2captcha** account if you need automated CAPTCHA solving.
- A host for Node + Python long-running services (your choice).

---

## 3. Database (Supabase)

1. Create a Supabase project.
2. Open **SQL Editor**, paste `database/schema.sql`, and **Run** (it is idempotent).
3. Copy from **Project Settings → API**: the **Project URL** and **service_role** key.

See `database/README.md` for full detail.

---

## 4. Email (Resend) — move off the sandbox sender

The dev setup uses `onboarding@resend.dev`, which can only send to your own
verified address. For production:

1. In Resend, add your domain (e.g. `availo.co.uk`) and create the DNS records
   it gives you (SPF, DKIM, and a Return-Path/MX). Wait for **Verified**.
2. Create a **production API key**.
3. Set on the backend:
   - `RESEND_API_KEY=<prod key>`
   - `EMAIL_FROM=Availo <alerts@availo.co.uk>` (must be on the verified domain)
4. Smoke test after deploy (requires the scraper key):
   ```
   curl -H "x-scraper-key: $SCRAPER_API_KEY" \
     "https://api.availo.co.uk/api/admin/test-email?to=you@example.com"
   ```

---

## 5. Residential proxies (scraper)

1. Buy a residential/rotating plan from your provider; get the gateway
   endpoint(s) and credentials.
2. Set `PROXY_LIST` (comma-separated) in the scraper environment:
   ```
   PROXY_LIST=http://user:pass@gw.provider.com:8000,socks5://user:pass@host:1080
   ```
3. Tune health/quarantine via `PROXY_MAX_CONSECUTIVE_FAILURES`,
   `PROXY_QUARANTINE_SECONDS`, `PROXY_HEALTHCHECK_URL`.
4. Leave `PROXY_LIST` empty only in dev (the worker advertises a fake source IP
   header against the mock site instead).

---

## 6. Provision the VPS (one-time)

On a fresh Ubuntu 22.04+ box, as a sudo user:

```bash
# System packages
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx python3 python3-venv python3-pip git ufw

# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PM2 (process manager for the Node services)
sudo npm install -g pm2

# Firewall: only SSH + HTTP/HTTPS are public
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Clone the repo to a stable path (the systemd unit assumes `/opt/testi-mvp`):

```bash
sudo git clone <your-repo-url> /opt/testi-mvp
sudo chown -R $USER:$USER /opt/testi-mvp
cd /opt/testi-mvp
```

> Backend (`:4000`) and mock target (`:8000`) bind to **localhost only** and are
> never exposed directly — Nginx is the single public entry point.

---

## 7. Backend — run with PM2

```bash
cd /opt/testi-mvp/backend
npm ci
cp .env.example .env      # then edit .env (see below)
```

`.env` (generate secrets with the command in §6 of `backend/.env.example`):

```env
NODE_ENV=production
PORT=4000
SCRAPER_API_KEY=<strong-random>          # backend FAILS CLOSED if unset
JWT_SECRET=<strong-random>               # enforced in production
CORS_ORIGIN=https://app.availo.co.uk     # comma-separated allowlist
SUPABASE_URL=https://<proj>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
RESEND_API_KEY=<prod-key>
EMAIL_FROM=Availo <alerts@availo.co.uk>
```

Start under PM2:

```bash
pm2 start src/index.js --name availo-backend --time
pm2 save
curl -s localhost:4000/health      # expect {"status":"ok","store":"supabase"}
```

> Always set `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` so `/health` reports
> `supabase` — the in-memory dev store is not for production.

---

## 8. Mock target — run with PM2 (current target until DVSA is wired)

Because the live DVSA target is not yet wired (§10), the scraper still points at
the mock site. Run it on localhost only:

```bash
cd /opt/testi-mvp/scraper
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pm2 start "python mock_site/server.py" --name availo-mock --time
pm2 save
```

> Keep `:8000` bound to localhost / behind the firewall — do **not** add an Nginx
> route for it. When you wire a real target, set `TARGET=dvsa` and stop this
> process (`pm2 delete availo-mock`).

---

## 9. Scraper — run with systemd

The repo ships a unit at `scraper/systemd/testi-scraper.service` (supervisor →
coordinator → workers, with jittered polling and auto-restart).

```bash
cd /opt/testi-mvp/scraper
cp .env.example .env      # then edit (see below)
npm --prefix /opt/testi-mvp install   # supervisor/coordinator use dotenv
mkdir -p logs
```

Scraper `.env`:

```env
BACKEND_URL=http://localhost:4000     # same box; localhost is fine
SCRAPER_API_KEY=<same as backend>
TARGET=mock                           # 'dvsa' is intentionally unimplemented
PROXY_LIST=<residential proxies>      # required for any real target
TLS_IMPERSONATE=chrome
USE_PLAYWRIGHT=false                  # true only if you run `playwright install chromium`
AUTO_BOOK=true                        # book for opted-in users
SUPERVISOR_RUN_INTERVAL_MS=60000      # jittered ±25%
```

Install and start the service:

```bash
sudo cp /opt/testi-mvp/scraper/systemd/testi-scraper.service /etc/systemd/system/
# Verify User=, WorkingDirectory=/opt/testi-mvp/scraper, and the node path match your box
sudo systemctl daemon-reload
sudo systemctl enable --now testi-scraper
sudo systemctl status testi-scraper
journalctl -u testi-scraper -f        # live logs
```

> **Python interpreter note:** the supervisor spawns workers via `python` from
> `PATH`, so a virtualenv is **not** auto-activated. Either install the scraper
> deps for the system interpreter (`pip3 install -r requirements.txt`), or add the
> venv to the unit with `Environment=PATH=/opt/testi-mvp/scraper/.venv/bin:/usr/bin`.

---

## 10. Nginx + frontend + TLS

Build the static frontend and serve it, proxying `/api` to the backend so there
is a single origin (no CORS surprises):

```bash
cd /opt/testi-mvp/frontend
npm ci && npm run build               # outputs dist/
```

Create `/etc/nginx/sites-available/availo`:

```nginx
server {
    listen 80;
    server_name app.availo.co.uk;

    root /opt/testi-mvp/frontend/dist;
    index index.html;

    # SPA: serve index.html for client-side routes
    location / {
        try_files $uri /index.html;
    }

    # API → backend on localhost:4000
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it and add a free Let's Encrypt certificate (Certbot rewrites the config
to listen on 443 and auto-renews):

```bash
sudo ln -s /etc/nginx/sites-available/availo /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d app.availo.co.uk
```

Point your domain's DNS **A record** for `app.availo.co.uk` at the VPS IP before
running Certbot. Since the frontend is same-origin, `CORS_ORIGIN` only matters if
you later split the API onto its own subdomain.

---

## 11. Real DVSA target (DEFERRED — read first)

The scraper currently targets the **mock** site via `TARGET=mock`. Pointing it at
the live DVSA service is a separate, deliberate step with **Terms-of-Service and
legal implications** (automated booking of public driving-test slots may breach
DVSA terms and UK regulations). Before any live wiring we should:

1. Review DVSA's terms and the relevant legal position together.
2. If proceeding, implement the `dvsa` branch in `scraper/target.py` plus a target
   adapter (selectors, queue handling, real CAPTCHA, 3-D Secure for payment),
   keeping the mock as the test harness.

Live DVSA wiring is **not** implemented (`TARGET=dvsa` raises by design).

---

## 12. Pre-launch security checklist

- [ ] `NODE_ENV=production` set on the backend.
- [ ] `JWT_SECRET` and `SCRAPER_API_KEY` are strong & unique (not the dev values).
- [ ] `CORS_ORIGIN` lists only your real frontend origin(s).
- [ ] Supabase service-role key is set **only** on the backend (never the frontend).
- [ ] `/health` reports `store: supabase`.
- [ ] TLS enabled (Certbot) and HTTP→HTTPS redirect in place.
- [ ] Backend (`:4000`) and mock (`:8000`) bind to localhost / blocked by `ufw`.
- [ ] Secrets live in `.env` files (chmod 600), never committed to git.

---

## 13. Operations cheatsheet

```bash
# Node services (PM2)
pm2 status                       # backend + mock health
pm2 logs availo-backend          # tail backend logs
pm2 restart availo-backend       # after a deploy
pm2 startup && pm2 save          # survive reboots (run the printed command)

# Scraper (systemd)
sudo systemctl restart testi-scraper
journalctl -u testi-scraper -f

# Deploy an update
cd /opt/testi-mvp && git pull
cd backend && npm ci && pm2 restart availo-backend
cd ../frontend && npm ci && npm run build   # Nginx serves dist/ immediately
sudo systemctl restart testi-scraper
```

### Kill-switch (soft pause)

The admin dashboard has a **Pause all workers / Resume** control backed by
`GET|POST /api/control`. Pausing sets a flag the coordinator checks each cycle
and the worker re-checks before booking, so **new work stops within one poll
cycle** (and in-flight runs skip the booking step). Toggle from the dashboard, or:

```bash
# Pause
curl -s -XPOST localhost:4000/api/control -H 'Content-Type: application/json' \
  -d '{"paused":true,"actor":"ops"}'
# Resume
curl -s -XPOST localhost:4000/api/control -H 'Content-Type: application/json' \
  -d '{"paused":false,"actor":"ops"}'
```

Every toggle is written to the audit log (`scraper_paused` / `scraper_resumed`).
For a **hard** emergency stop, `sudo systemctl stop testi-scraper` halts the
process immediately.
