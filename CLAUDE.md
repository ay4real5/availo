# CLAUDE.md — Availo project context

> This file is auto-loaded by Claude Code every session. It's the handoff/context doc:
> read it first. It captures the **rules that must never change** and where things
> stand, so any Claude Code (on any machine) picks up where we left off.

## Continuing on another machine
Claude Code auto-loads this file, so you don't need to re-explain the project. On a new
laptop, clone the repo, open it in Claude Code, and paste a starter like:

> "This is the Availo project — read `CLAUDE.md` and `docs/` for context. We're
> continuing where we left off. Next I want to **[your next task]**."

Or just: *"Read `CLAUDE.md` and give me the Availo status and what's left."* You only
supply the next goal; everything else is in this file.

## What Availo is
A tool that helps **UK learner drivers find and grab earlier DVSA driving-test
cancellation slots** — without breaking DVSA's rules and without auto-booking. It's a
browser **extension** (Chrome/Edge/Firefox/Firefox-Android, plus an iPhone Safari
build) backed by a small **backend** (accounts + alerts) and a **frontend** web app.
The extension watches the real DVSA "change your driving test" page the user has open,
spots an earlier slot, highlights it, and autofills the user's own details — **the
human makes every booking.**

## ⛔ The immovable ethical boundary (MOST IMPORTANT — never weaken this)
Any change must preserve ALL of these. They are the whole point; they keep users' DVSA
accounts safe and the product legitimate:
- The extension **only reads the page, highlights the slot, and autofills the user's
  OWN details.** It **NEVER** clicks Select/Confirm/Pay, **never books, holds, reserves,
  or pays**, and **never auto-submits** login or search unattended.
- **Never** uses proxies or IP rotation. **Never** tries to evade DVSA security — it
  **STOPS** the moment it sees a block, CAPTCHA, or "there is a problem" page.
- **Never collect or transmit behavioural telemetry** (mouse/scroll/click tracking,
  fingerprinting, or anything designed to make automated activity look human to DVSA).
  A prior version shipped an undisclosed `content.js` that did this — it's been removed
  and must not come back in any form.
- **Never pace or throttle activity for the purpose of hiding a pattern from DVSA**
  (e.g. multi-account/single-IP rotation timed "so DVSA sees normal activity"). A prior
  "roster mode" did this via `roster.js` — it's been removed in favour of a single-user
  `vault.js`. Availo is single-user only; do not reintroduce multi-account rotation.
- The user's **driving licence number and booking reference are stored only in the
  browser** (`chrome.storage.local`, via `vault.js`) and are **never sent to Availo's
  servers**. The backend never logs into DVSA and never receives sensitive data (only a
  short display first-name label).
- **No server-side / unattended monitoring of DVSA.** Watching runs in the user's own
  browser session. Auto-refresh is deliberately slow (≥90s) and human-paced.

If a request asks to cross any of these (auto-book, auto-hold, central login for users,
IP rotation, multi-account pacing/rotation, behavioural telemetry, faster/aggressive
polling, bypassing a check), **decline and offer an in-bounds alternative.** This has
come up repeatedly and the answer is always no.

## Layout
- `chrome-extension/` — the MV3 extension (the core), single-user only. Detection/
  autofill/watch: `dvsa-heuristics.js`, `selectors.js`, `watch-match.js`,
  `fastpath-util.js`, `vault.js` (licence/booking-ref storage), `background.js`,
  `popup.js`, `options.js`. `build.mjs` emits clean store builds. Dev-only:
  `dev-fixture/` (fake DVSA pages), `serve-practice.ps1` + `start-practice.cmd`,
  `scripts/browser-smoke.py`.
- `backend/` — Node/Express + Supabase (Postgres), Web Push (VAPID) + email (Resend),
  JWT auth. Deployed on **Render**. Never touches DVSA.
- `frontend/` — React/Vite PWA. Deployed on **Vercel**. Hosts `public/privacy.html`.
- `docs/` — all the guides (see Pointers below).
- `scraper/`, `database/`, root `test_*.py` — supporting/mock/test assets.

## Key commands
- Backend tests (43): `npm test` (repo root) — also `npm run lint`.
- Extension tests (50): `cd chrome-extension && npm test`.
- Build store packages: `cd chrome-extension && npm run build:all` → clean
  `chrome-build/ firefox-build/ safari-build/` (no localhost, prod backend baked in).
- Detection smoke (real browser, 7 checks): `cd chrome-extension && python
  scripts/browser-smoke.py`.
- Local "see it work" demo: run `chrome-extension/start-practice.cmd` (fake DVSA site
  on localhost:5555, no installs), then load `chrome-extension/` unpacked in Chrome →
  Practice run. See `docs/TRY_IT.md`.

## Platform status
- ✅ Chrome / Edge / Firefox desktop / Firefox Android — ready.
- ✅ iPhone (Safari) — **builds green** on a cloud Mac via
  `.github/workflows/safari-build.yml` (Actions → safari-build → Run workflow). The
  generated Xcode **scheme is named `Availo`**. Still needs an **Apple Developer
  account ($99/yr)** to sign + submit to the App Store (`docs/IOS_BUILD.md`).

## What's left (all user-owned; nothing technically blocked)
1. Set alert keys on **Render**: `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (push) and
   `RESEND_API_KEY`/`EMAIL_FROM` (email) so alerts actually send.
2. Confirm auto-detection against **one real DVSA booking** — read-only "Check this
   page" only (never book as a test).
3. A short **closed beta** (3–5 real learners), watching for account safety.
4. **Publish:** Chrome Web Store + Firefox AMO (`docs/PUBLISHING.md`), iPhone App Store
   (`docs/IOS_BUILD.md`).

## Pointers
- See it work: `docs/TRY_IT.md`
- Install & use: `docs/EXTENSION_INSTALL.md`
- Pre-launch test ladder: `docs/TESTING.md`
- Publish (Chrome/Firefox): `docs/PUBLISHING.md`
- iPhone build/submit: `docs/IOS_BUILD.md`
- Architecture / deploy: `docs/ARCHITECTURE.md`, `DEPLOYMENT.md`, `render.yaml`

## Conventions
- The unrelated `Abims2026/` folder is a **different project** — gitignored, never part
  of Availo. Don't commit it here.
- Live URLs: frontend `https://availo-frontend-one.vercel.app`, backend
  `https://availo-backend-4dbx.onrender.com`. Repo: `github.com/ay4real5/availo`.
