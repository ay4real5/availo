# Deploy Availo — Vercel + Render + Supabase (no VPS)

A fully-managed path: **frontend on Vercel**, **backend on Render**, **database
on Supabase**. The scraper + mock target come in Phase 2 (Docker worker).

```
Browser ─► Vercel (React)  ──/api/* rewrite──►  Render (Express)  ──►  Supabase
                                                     ▲
                                   (Phase 2)  Render Docker worker = scraper + mock
```

---

## Phase 1 — get the app live

### 1. Supabase (database)
1. In your Supabase project → **SQL Editor**, paste `database/schema.sql` and **Run** (idempotent).
2. From **Project Settings → API**, copy the **Project URL** and the **service_role** key.

### 2. Backend on Render
1. Push this repo to GitHub.
2. Render Dashboard → **New + → Blueprint** → select the repo. Render reads
   `render.yaml` and creates the **availo-backend** web service.
3. When prompted, set the `sync:false` env vars:
   - `SUPABASE_URL` = your Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your service_role key
   - `CORS_ORIGIN` = (leave blank for now; fill in after Step 3)
   - `RESEND_API_KEY` / `EMAIL_FROM` = optional (email alerts)
4. Deploy. When it's live, note the URL, e.g. `https://availo-backend.onrender.com`.
5. Verify: visit `…/health` → should report `{"status":"ok","store":"supabase"}`.

> The free Render plan sleeps after inactivity; the first request may be slow.

### 3. Frontend on Vercel
1. Edit `frontend/vercel.json` → set the rewrite **destination** to your real
   backend URL from Step 2 (replace `availo-backend.onrender.com`). Commit.
2. Vercel → **Add New → Project** → import the repo.
   - **Root Directory:** `frontend`
   - Framework (Vite), build, and output are read from `vercel.json`.
3. Deploy. Note the URL, e.g. `https://availo.vercel.app`.

The frontend calls `/api/*`; Vercel proxies that to Render server-side, so the
browser sees a single origin (no CORS setup needed for normal use). Only set
`CORS_ORIGIN` on Render if you ever call the backend directly from the browser.

### 4. Smoke test
- Open the Vercel URL → register → set preferences → save a test card → dashboard loads.
- Bookings/slots will be empty until Phase 2 (the scraper) is running.

---

## Admin protection (implemented)

The **admin dashboard** and its sensitive endpoints (`/api/control` toggle,
`/api/sessions`, `/api/audit`, `/api/slots` reads, `/api/notifications/*`,
`/api/rules` config/policies, `/api/scraper/jobs`, `/api/users`,
`/api/admin/scrape`) are gated by an **admin token**:

- Set `ADMIN_TOKEN` on the backend (the `render.yaml` generates one — copy it
  from the service's **Environment** tab).
- In production the admin surface **fails closed**: without `ADMIN_TOKEN` set,
  those endpoints return `503`; with it set, requests must send a matching
  `x-admin-token` header.
- The dashboard shows an **Admin sign-in** screen; paste the token once and it's
  stored in the browser and sent automatically. Use **Lock** to clear it.
- Locally (non-production) the admin surface stays open for convenience.

Public user flows (`/api/auth/*`) and the scraper's own endpoints (scraper key)
are unaffected.

---

## Phase 2 — scraper + mock target (Docker on Render)

The scraper needs **Node** (supervisor/coordinator) **and** Python (worker), so
it ships as a Docker image. `scraper/Dockerfile` builds both, and the same image
runs two Render services (the worker, and the mock target).

> **Cost note:** Render **Background Workers are not free** (Starter ~\$7/mo).
> The mock can be a **free** web service. If you'd rather not pay, you can run
> the scraper locally pointed at the deployed backend (`BACKEND_URL=…onrender.com`).

### Add these services to `render.yaml`

```yaml
  - type: worker
    name: availo-scraper
    runtime: docker
    rootDir: scraper
    dockerfilePath: ./Dockerfile
    plan: starter            # workers are paid on Render
    autoDeploy: true
    envVars:
      - key: TARGET
        value: mock
      - key: AUTO_BOOK
        value: "true"
      - key: USE_PLAYWRIGHT
        value: "false"       # set true only if you need real-browser discovery
      - key: BACKEND_URL
        sync: false          # https://availo-backend.onrender.com
      - key: MOCK_URL
        sync: false          # the availo-mock URL below
      - key: SCRAPER_API_KEY
        fromService:
          name: availo-backend
          type: web
          envVarKey: SCRAPER_API_KEY   # reuse the backend's generated key

  - type: web
    name: availo-mock
    runtime: docker
    rootDir: scraper
    dockerfilePath: ./Dockerfile
    dockerCommand: sh -c "cd mock_site && python server.py"
    plan: free
    envVars:
      - key: MOCK_SECRET
        generateValue: true
```

### Steps
1. Commit `scraper/Dockerfile` + `scraper/package.json` (already added) and the
   `render.yaml` block above.
2. In Render, the Blueprint picks up the two new services. Set the `sync:false`
   vars: `BACKEND_URL` (your backend URL) and `MOCK_URL` (the mock service URL).
3. Deploy. The worker polls every ~60s (jittered), respects the **kill-switch**,
   discovers slots, and (for opted-in users) auto-books — end to end, exactly as
   it does locally.

To point at the **real DVSA** later, set `TARGET=dvsa` + `PROXY_LIST` and complete
the legal/ToS review first (see `DEPLOYMENT.md` §9).
