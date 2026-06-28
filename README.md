# Testi MVP

A browser-based MVP for a Testi-style driving-test cancellation finder. It simulates the scraper, tracks sessions, evaluates anti-bot rules, and exposes an observable dashboard.

## Project structure

```
.
├── backend/          # Node.js + Express API
├── frontend/         # React + Vite dashboard
├── scraper/          # Mock DVSA site + Playwright worker + coordinator
└── database/         # PostgreSQL schema
```

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Start the backend

```bash
cp backend/.env.example backend/.env
npm run dev:backend
```

Backend runs on `http://localhost:4000`.

### 3. Start the mock DVSA site

```bash
python scraper/mock_site/server.py
```

Runs on `http://localhost:8000`. It now includes `/delay`, `/error` and `/retry` endpoints for realistic failure simulation.

### 4. Seed a demo user

```bash
npm run --workspace backend seed
```

This creates `demo@example.com` with a test date three months in the future so that scraped slots trigger notifications.

### 5. Run the real Playwright scraper

Install Python dependencies and browser binaries:

```bash
cd scraper
pip install -r requirements.txt
python -m playwright install chromium
```

Run one centre:

```bash
python worker.py --centre Bolton
```

Or run the coordinator to scrape all configured centres concurrently:

```bash
node run_workers.js
```

Set `CONCURRENCY` in `scraper/.env` to control how many centres run in parallel.

### 6. Start the frontend

```bash
npm run dev:frontend
```

Runs on `http://localhost:3000` and proxies `/api` to the backend.

## Dashboard

Open `http://localhost:3000`, enter an email and current test date, and click **Run Scraper Job**. The dashboard will:

1. Trigger a scraper job (mock backend or Playwright worker).
2. Show approved slots and quarantined slots.
3. Display the notification queue and allow sending pending notifications.

The Playwright worker (terminal 5) does the same end-to-end flow using a real headless browser:

1. Create a scraper job with a random proxy, IP and user-agent.
2. Visit the mock DVSA site (`/`, `/login`, optionally `/bot-trap`, `/slots`).
3. Collect slots and provenance.
4. Report slots to the backend via `/api/slots/report-centre`.
5. The rules engine decides approve, quarantine or ignore.

## Key backend endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/sessions` | List tracked sessions |
| `GET` | `/api/sessions/analytics/summary` | Bot rate summary |
| `PUT` | `/api/sessions/:id/flag` | Manually flag a session |
| `GET` | `/api/slots` | List found slots |
| `POST` | `/api/slots/report-centre` | Scraper reports slots; rules decide approve/quarantine |
| `GET` | `/api/notifications/quarantine` | List quarantined slots |
| `POST` | `/api/notifications/quarantine/:id/release` | Manually release a quarantined slot |
| `POST` | `/api/notifications/quarantine/:id/reject` | Manually reject a quarantined slot |
| `GET` | `/api/notifications/queue` | List notification queue |
| `POST` | `/api/notifications/send-pending` | Mark pending notifications as sent |
| `GET` | `/api/scraper/jobs` | List scraper jobs |
| `POST` | `/api/scraper/jobs` | Create a scraper job |
| `PUT` | `/api/scraper/jobs/:id` | Update a scraper job |
| `GET` | `/api/scraper/run` | Run one mock scrape job |
| `POST` | `/api/scraper/heartbeat` | Scraper coordinator heartbeat |
| `POST` | `/api/rules/run` | Evaluate a single rule |
| `POST` | `/api/rules/evaluate` | Evaluate all rules |
| `GET` | `/api/rules/config` | Get current rule config |
| `POST` | `/api/rules/config` | Update rule config |
| `POST` | `/api/rules/reload` | Reload config from disk |
| `GET` | `/api/rules/policies` | List policy versions |
| `POST` | `/api/rules/policies/snapshot` | Snapshot current config |
| `POST` | `/api/rules/policies/:id/activate` | Activate a policy version |
| `POST` | `/api/rules/policies/rollback` | Roll back to previous policy |
| `POST` | `/api/users` | Create a demo user |
| `GET` | `/api/audit` | Query audit log |

## Manual review UX

The dashboard shows quarantined slots and lets an operator review them. Each row has a **Review** button that opens:

- **Release** — moves the slot to `approved` and queues a notification
- **Reject** — moves the slot to `rejected` with a reason
- A reason text field (optional, defaults to "Manual review")

Backend endpoints:

- `POST /api/notifications/quarantine/:id/release` — release with optional `{ reason }`
- `POST /api/notifications/quarantine/:id/reject` — reject with optional `{ reason }`

## Supabase / Postgres backend

By default the backend uses `dev-store.json`. To switch to a real database:

1. Create a project at https://supabase.com and copy the **Service Role Key** and project URL.
2. Run `database/schema.sql` on your project:
   - Open the Supabase SQL Editor, paste the contents of `database/schema.sql`, and run it.
   - Or use psql:
     ```bash
     psql "postgresql://<user>:<pass>@<host>:5432/postgres" -f database/schema.sql
     ```
3. Update `backend/.env`:
   ```env
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   ```
4. Restart the backend. The logs will show `[supabase] using real Supabase client ...`.
5. Run the backend tests (`npm run test`) to confirm the dev store still works locally.

## CI and secrets management

A GitHub Actions workflow is defined in `.github/workflows/ci.yml`. It runs backend lint/tests and the frontend build on every push and pull request.

**Do not commit `.env` files.** The repo includes `.env.example` files as templates. Copy them to real `.env` files and fill in secrets:

```bash
cp .env.example backend/.env
cp backend/.env.example backend/.env  # per-package defaults
```

Required secrets for production deployments:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SLACK_WEBHOOK_URL` (optional)
- `SCRAPER_API_KEY` (set to a strong random value)

Run the full local verification before pushing:

```bash
npm run verify
```

## Observability & alerting

The backend exposes a Prometheus-compatible `/metrics` endpoint:

```bash
curl http://localhost:4000/metrics
```

Metrics include:

- `slots_discovered_total` — slots reported by scrapers
- `slots_quarantined_total` — slots quarantined by the rules engine
- `slots_approved_total` — slots approved for notification
- `scraper_jobs_total` — scraper jobs completed by status
- `notifications_queued_total` — notifications queued

To enable Slack alerts for quarantine spikes:

1. Create a Slack Incoming Webhook URL and add it to `backend/.env`:
   ```env
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
   QUARANTINE_ALERT_THRESHOLD=5
   ```
2. A background job checks every minute for `QUARANTINE_ALERT_THRESHOLD` (default 5) quarantined slots in the last minute and posts to Slack.
3. Set `DISABLE_SPIKE_DETECTOR=true` to turn it off.

## Rules engine

Rules are defined in `backend/config/rules.json` and loaded at startup. They include:

- `detect_bot` — high RPM, honeypot hits, headless UA, missing scroll/mouse events
- `flag_early_slot` — slot is earlier than the user's current test date
- `rate_limit_ip` — too many requests from a single IP in a configurable window

Admin endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/rules` | List rules, thresholds, and descriptions |
| `POST` | `/api/rules/run` | Evaluate a single rule |
| `POST` | `/api/rules/evaluate` | Evaluate all rules against a payload |
| `GET` | `/api/rules/config` | Get current rule config |
| `POST` | `/api/rules/config` | Update rule config (writes to `rules.json`) |
| `POST` | `/api/rules/reload` | Reload config from disk |

Example: tune the quarantine threshold at runtime:

```bash
curl -X POST http://localhost:4000/api/rules/config \
  -H "Content-Type: application/json" \
  -d '{"quarantineThreshold": 70}'
```

## Audit log

Every rule decision and manual review action is recorded in the `audit_log` table:

- `slot_quarantined`, `slot_approved`, `slot_ignored`
- `slot_released`, `slot_rejected`
- `rules_config_updated`, `rules_config_reloaded`

Query the log:

```bash
curl "http://localhost:4000/api/audit?event_type=slot_quarantined"
```

The dashboard includes an **Audit Log** viewer with event filtering.

## Scraper deployment and orchestration

The scraper can be run in three ways:

1. **One-shot** (development):
   ```bash
   cd scraper
   node run_workers.js
   ```

2. **Supervised loop** (recommended for production):
   ```bash
   cd scraper
   node supervisor.js
   ```
   The supervisor restarts the coordinator on failure with exponential backoff and enforces a configurable run interval. Tune it with:
   - `SUPERVISOR_MAX_RETRIES`
   - `SUPERVISOR_BASE_DELAY_MS`
   - `SUPERVISOR_MAX_DELAY_MS`
   - `SUPERVISOR_RUN_INTERVAL_MS`

3. **PM2**:
   ```bash
   cd scraper
   npm install -g pm2
   pm2 start ecosystem.config.js
   pm2 save
   ```

4. **systemd** (Linux server):
   ```bash
   sudo cp scraper/systemd/testi-scraper.service /etc/systemd/system/
   sudo systemctl enable testi-scraper
   sudo systemctl start testi-scraper
   ```

The coordinator sends a heartbeat to `POST /api/scraper/heartbeat` at the start of every run so the backend can detect stale scrapers.

## CAPTCHA solver simulator

The scraper includes a CAPTCHA solver simulator at `scraper/captcha_solver.py`. When the mock DVSA site responds with a `captcha_required` challenge, the solver simulates a 2-second solving delay and posts a token back to the mock site. If the token is accepted, the IP is unflagged and the worker retries the slots request.

Set the simulated delay:

```env
CAPTCHA_SOLVER_DELAY=2
```

In production, replace the `solve_challenge` function with a call to a real provider (2captcha, Anti-Captcha, etc.).

## Residential proxy rotation

The scraper rotates proxies per worker via `scraper/proxy_rotator.py`. For local development it uses a pool of mock residential proxies. In production, pass a comma-separated list of real proxies:

```env
PROXY_LIST=http://user:pass@proxy1:port,http://user:pass@proxy2:port
```

The chosen proxy is reported in the `scraper_jobs` table for provenance.

## Chrome extension for behaviour capture

A minimal Chrome extension in `chrome-extension/` captures real human scroll/click/mouse-move events on the booking site and posts them to `POST /api/sessions/behaviour`. The data enriches the bot detector with genuine interaction signals.

To load it:

1. Open Chrome → `chrome://extensions` → enable Developer mode.
2. Click **Load unpacked** and select the `chrome-extension/` folder.
3. Visit the mock site or the real DVSA site to start sending behaviour metrics.

## Democrite-style policy engine

Rule configurations can be snapshotted, activated, and rolled back:

- `GET /api/rules/policies` — list policy versions
- `POST /api/rules/policies/snapshot` — snapshot the current config
- `POST /api/rules/policies/:id/activate` — activate a specific version
- `POST /api/rules/policies/rollback` — roll back to the previous version

Example:

```bash
curl -X POST http://localhost:4000/api/rules/policies/snapshot \
  -H "Content-Type: application/json" \
  -d '{"note": "Before raising threshold"}'

curl -X POST http://localhost:4000/api/rules/config \
  -H "Content-Type: application/json" \
  -d '{"quarantineThreshold": 80}'

curl -X POST http://localhost:4000/api/rules/policies/rollback
```

## Future extensions

- Real CAPTCHA provider integration
- Proxy health checks and rotation strategies
- Real DVSA Chrome extension publishing
- Machine-learning bot detection on behaviour data
- Distributed scraper fleet coordination
