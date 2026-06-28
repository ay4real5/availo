# Availo — Architecture

A full-stack platform that monitors driving-test availability, alerts users to
earlier slots, and can **auto-book** on their behalf — built to mirror the real
GOV.UK/DVSA journey with a strong anti-detection and observability story.

> Status: runs end-to-end today against a **mock DVSA site**. The live DVSA
> target is intentionally **not** wired (see [§9](#9-targets-mock-vs-live)).

---

## 1. System map

```
                ┌────────────────────────┐
                │  Frontend (React/Vite)  │  GOV.UK-styled user + admin UI
                └───────────┬────────────┘
                            │  /api/*  (JWT for users, scraper key for workers)
                ┌───────────▼────────────┐
                │ Backend API (Express)   │  auth, prefs, slots, bookings,
                │                         │  rules, notifications, audit, metrics
                └─────┬──────────────┬────┘
        service role  │              │  Resend / Slack
              ┌───────▼──────┐   ┌───▼──────────┐
              │  Postgres    │   │  Email / SMS │
              │  (Supabase)  │   │  Slack alerts│
              └───────▲──────┘   └──────────────┘
                      │  scraper API key
        ┌─────────────┴───────────────┐
        │  Scraper supervisor (Node)   │  jittered polling loop
        │   └─ coordinator (run_workers)│  fan-out N centres
        │        └─ worker.py (Python)  │  the booking journey + evasion
        └─────────────┬────────────────┘
                      │  TARGET=mock|dvsa
              ┌───────▼────────┐
              │  Mock DVSA site │  queue, CAPTCHA, bot traps, rate limits
              │  (Python)       │  — adversary + test harness
              └─────────────────┘
```

---

## 2. Components

| Component | Path | Runtime | Responsibility |
|-----------|------|---------|----------------|
| Frontend | `frontend/` | React + Vite | User dashboard (alerts, bookings, payment card) + admin dashboard |
| Backend API | `backend/` | Node 18+ / Express | Control plane: auth, business logic, persistence, email, audit, metrics |
| Scraper | `scraper/` | Python 3.11+ + Node orchestration | Discovers slots and auto-books, evading detection |
| Mock DVSA | `scraper/mock_site/` | Python | High-fidelity adversary; dev/test target |
| Database | `database/schema.sql` | Postgres (Supabase) | Persistence |
| Chrome extension | `chrome-extension/` | MV3 | Companion capture helper |

---

## 3. Backend API (`backend/src`)

Entry: `index.js` → `app.js` (helmet, CORS allowlist, session tracking, error
handler). Routes under `routes/`:

- **`auth.js`** — register/login (bcrypt + JWT), `preferences` (centre, target
  date, search window, **auto-book + licence**), tokenised **payment-method**
  CRUD, `my-slots`, `my-bookings` (user-scoped).
- **`slots.js`** — `report-centre` (scraper posts discovered slots → rule engine
  → fan-out to matching users + email), `book` (records a confirmed booking),
  bookings listing.
- **`scraper.js`** — job lifecycle (`jobs`), `centres`, `heartbeat`, and
  `booking-requests` (which users opted into auto-booking, with their licence +
  payment token).
- **`sessions.js`** — session + bot analytics. **`notifications.js`** —
  quarantine review + queue. **`rules.js`** — run a rule against a payload.
  **`users.js`** — admin user creation.

Libraries under `lib/`:

- **`supabase.js`** — returns the real Supabase client when `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` are set, otherwise a **drop-in in-memory dev store**
  (`dev-store.json`) implementing the same chainable query builder. This is why
  the app runs with zero external services in dev.
- **`payments.js`** — validates a card (Luhn + expiry), then stores **only** an
  opaque `tok_…` token plus masked `brand/last4/exp`. Raw PAN/CVC are discarded.
- **`ruleEngine.js` / `policyEngine.js`** — score each discovered slot and decide
  `approved` vs `quarantined` (e.g. suspicious provenance, anomaly spikes).
- **`email.js`** — Resend integration (welcome + slot-alert templates).
- **`spikeDetector.js` + `alerts.js`** — background watcher that Slack-alerts on
  quarantine spikes. **`metrics.js`** — Prometheus counters at `/metrics`.
- **`audit.js`** — append-only event log (`/api/audit`).

### Auth model
- **Users** authenticate with email/password → JWT (`Authorization: Bearer`).
- **Scraper/workers** authenticate with `x-scraper-key` (`SCRAPER_API_KEY`).
- **Admin** endpoints (`/api/admin/*`) require the scraper key.

---

## 4. Data model (`database/schema.sql`)

Idempotent Postgres schema. Key tables:

- `users` — account, target date, **auto_book**, **licence_number**, tokenised
  card metadata.
- `user_preferences` — per-user centre, notification channels, search window.
- `available_slots` — discovered slots (`pending|approved|quarantined|booked`)
  with provenance (`scraped_by_job`, `proxy_used`, `source_meta`, `rule_meta`).
- `bookings` — confirmed bookings attributed to a user.
- `scraper_jobs` — each run (status, proxy/IP/UA, slots found).
- `sessions`, `bot_trap_visits` — traffic + bot signals.
- `notification_queue`, `audit_log` — outbound + immutable trail.

`updated_at` is maintained by a trigger; RLS is documented but left off because
the backend uses the service-role key. See `database/README.md`.

---

## 5. Scraper (`scraper/`)

Three layers:

1. **Supervisor** (`supervisor.js`) — long-running loop. Spawns the coordinator,
   enforces a per-run timeout, retries with exponential backoff, and sleeps a
   **jittered** interval between runs (a fixed cadence is itself a bot signal).
2. **Coordinator** (`run_workers.js`) — sends a heartbeat, fetches centres from
   the backend, and fans workers out `CONCURRENCY` at a time.
3. **Worker** (`worker.py`) — drives one centre through the booking **journey**:
   `landing → virtual queue → login → search → (book → pay)`.

### The booking journey
- Realistic pacing via `human_delay()` (Gaussian jitter), Referer chains, and
  occasional "accidental" bot-trap clicks.
- CSRF tokens carried after login; CAPTCHA challenges solved (simulator or
  2captcha) with escalating difficulty handling.
- **Auto-book**: for each opted-in user, pick the first slot **earlier than their
  target date**, hold it, and pay with their tokenised card — each user gets a
  **distinct sticky residential identity** so bookings aren't fingerprint-linked.

---

## 6. Anti-detection design (the interesting part)

This is what makes the scraper resemble real, distributed human traffic. If you
need to remember "how does evasion work", read this section.

- **TLS / JA3 impersonation** (`httpclient.py`) — uses `curl_cffi` to present a
  real Chrome TLS ClientHello (JA3 fingerprint), so the handshake matches a real
  browser, not Python's default stack. Falls back to `httpx` if unavailable.
- **Browser fingerprints** (`fingerprint.py`) — rotates a coherent identity
  (User-Agent + Accept-Language + headers + a source IP advertised to the mock).
- **Residential proxy rotation** (`proxy_rotator.py`) — picks from `PROXY_LIST`,
  supports **sticky** per-user proxies (one consistent IP per candidate journey),
  and **quarantines** proxies after repeated failures (`PROXY_MAX_CONSECUTIVE_FAILURES`,
  `PROXY_QUARANTINE_SECONDS`) with health checks. State persists in `.proxy_state.json`.
- **Real-browser discovery** (`playwright_discovery.py`, opt-in `USE_PLAYWRIGHT`)
  — drives a genuine headless Chromium (real JS/canvas/TLS) for maximum realism,
  with automatic fallback to `curl_cffi`.
- **Detection feedback loop** (`worker.py`) — on a block/CAPTCHA, the worker
  quarantines the proxy, rotates to a fresh identity + healthy proxy, cools down,
  and retries up to `MAX_IDENTITY_ATTEMPTS`.
- **Resilience** — a **circuit breaker** stops hammering a failing backend;
  transient errors retry with jittered backoff; queue waits have a timeout.
- **Cadence jitter** — the supervisor randomises the inter-run interval ±25%.

### How the mock site fights back (`scraper/mock_site/server.py`)
A deliberate adversary so the evasion logic is genuinely exercised: GOV.UK-styled
HTML journey, a **virtual queue**, **bot-trap** URLs, **rate limiting** and
**IP blocking**, **escalating CAPTCHA** difficulty, **CSRF** enforcement, and
**slot-vanish** races (a held slot can 409 if it disappears). It is a test
harness — **not** for production.

---

## 7. Frontend (`frontend/src`)

- **User flow** (`pages/`): `Landing → Register/Login → Preferences → UserDashboard`.
  Preferences captures centre, target date, search window, **auto-book + licence**.
  The dashboard shows active-alert status, live matched slots, **auto-book status**,
  **booking history**, and **payment-card management** (`components/PaymentMethod.jsx`).
- **Admin** (`components/Dashboard.jsx`): `SessionList`, `SlotViewer`,
  `QuarantineViewer`, `NotificationQueue`, `AuditLog`, `JobViewer`, `AnalyticsGraph`.
- **API layer** (`api.js`): thin `fetch` helpers (token-aware) + an axios client
  for admin reads. The app calls `/api/*`, so it is served behind the same origin
  as the backend (or via an Nginx `/api` proxy — see `DEPLOYMENT.md`).

---

## 8. Observability & safety

- **Audit log** — every meaningful event (welcome, slot alert, booking) is
  recorded and queryable.
- **Metrics** — Prometheus at `/metrics`; **health** at `/health` (reports
  `supabase` vs `dev-store`).
- **Quarantine + spike detection** — suspicious slots are held for manual review;
  spikes trigger Slack alerts.
- **Fail-closed auth** — the scraper key middleware rejects all requests if the
  key is unset; `JWT_SECRET` is enforced in production.

---

## 9. Targets: mock vs live

`scraper/target.py` resolves `TARGET=mock|dvsa`:

- **`mock`** (default) — drives `scraper/mock_site` (the test harness).
- **`dvsa`** — an **explicit `NotImplementedError` stub**. Wiring the live DVSA
  service has Terms-of-Service and legal implications and must be enabled only
  after a deliberate decision and review.

---

## 10. Repository layout

```
testi-mvp/
├─ backend/        Express API (src/{routes,lib,middleware})
├─ frontend/       React + Vite (src/{pages,components})
├─ scraper/        worker.py, supervisor.js, run_workers.js, evasion libs
│  └─ mock_site/   adversarial mock DVSA (server.py, templates.py)
├─ database/       schema.sql + README
├─ chrome-extension/
├─ docs/           ARCHITECTURE.md (this file)
├─ DEPLOYMENT.md   production runbook (VPS: PM2 + systemd + Nginx + SSL)
└─ test_*.py       end-to-end tests
```
