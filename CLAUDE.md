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
- **Never auto-navigate DVSA's booking flow** — no clicking month arrows, "Next
  available", "Continue", or otherwise driving the calendar/search programmatically.
  Reloading the single page the user is already sitting on is the ceiling; anything that
  steps through DVSA's UI on its own is "automated searching" (what the UK 2024
  regulations target) and was explicitly declined 2026-07-16. Availo only reads the
  month the user has chosen to display.
- **Never try to reduce/avoid the CAPTCHA by disguising traffic** (IP/UA/fingerprint,
  solving, retrying). The only sanctioned way to trip it less is to genuinely behave
  gentler (slower refresh, one tab, breaks). When it appears, STOP.

If a request asks to cross any of these (auto-book, auto-hold, central login for users,
IP rotation, multi-account pacing/rotation, behavioural telemetry, faster/aggressive
polling, auto-navigating the calendar, defeating the CAPTCHA, bypassing a check),
**decline and offer an in-bounds alternative.** This has come up repeatedly and the
answer is always no.

## Layout
- `chrome-extension/` — the MV3 extension (the core), single-user only. Detection/
  autofill/watch: `dvsa-heuristics.js`, `selectors.js`, `watch-match.js`,
  `fastpath-util.js`, `vault.js` (licence/booking-ref storage), `dvsa-centres.js`
  (official 317-centre list for the options autocomplete), `background.js`, `popup.js`,
  `options.js`. `build.mjs` emits clean store builds — the SAME detection files ship to
  all three targets, so any selectors/heuristics fix applies to Firefox + Safari too.
  Dev-only: `dev-fixture/` (fake DVSA pages incl. `calendar.html`), `serve-practice.ps1`
  + `start-practice.cmd`, `scripts/browser-smoke.py`.
  - `selectors.js` (`AvailoResolve`) understands BOTH the simple row/list results layout
    (fixture) AND the REAL DVSA month-calendar grid: bookable days are
    `td.BookingCalendar-date--bookable > … > a[data-date="YYYY-MM-DD"]`; the centre is
    read from `#chosen-test-centre h1`. Confirmed against live DVSA markup 2026-07-16.
    NOTE: other months' availability is NOT in the DOM — `#days`/`#months` are just
    weekday/month name labels — so read-only detection can only see the currently
    displayed month (see boundary: no auto-navigation).
- `backend/` — Node/Express + Supabase (Postgres), Web Push (VAPID) + email (Resend),
  JWT auth. Deployed on **Render**. Never touches DVSA.
- `frontend/` — React/Vite PWA. Deployed on **Vercel**. Hosts `public/privacy.html`.
- `docs/` — all the guides (see Pointers below).
- `scraper/`, `database/`, root `test_*.py` — supporting/mock/test assets.

## Progress log — 2026-07-16 (live real-DVSA testing session)
Tested against the real `driverpracticaltest.dvsa.gov.uk` for the first time; fixed the
gaps it exposed. All committed + pushed to `origin/main`:
- **Datetime validation** (`watch.js`, `auth.js`): `z.string().datetime()` rejected
  Supabase's `+00:00` timestamps → added `{ offset: true }`. Broke Start Watching until
  fixed.
- **Supabase**: the live project was missing the `watch_sessions` table — user re-ran
  `database/schema.sql` in the Supabase SQL Editor (idempotent, `IF NOT EXISTS`). Now
  works. Any fresh Supabase project needs schema.sql run once.
- **Preferences sync** (`options.js`): saving the "Your details" vault now also POSTs
  centre + target date to `/api/auth/preferences` (never licence/booking-ref). Before,
  nothing in the extension ever WROTE prefs, so Start Watching failed with "set your
  centre and test date first" and prefs could only be set by hand.
- **Calendar-grid detection** (`selectors.js`): now reads the real DVSA month calendar,
  not just the fixture's row list. See Layout note.
- **Centre verification** (`selectors.js`): reads centre from `#chosen-test-centre h1`
  and only matches dates for the watched centre (was mislabelling e.g. Ayr dates as the
  saved Chorley centre).
- **Block detection** (`dvsa-heuristics.js`): strengthened `looksLikeBlock()` with the
  real Imperva/hCaptcha challenge wording ("Additional security check is required",
  "Imperva", "I am human") + regression test.
- **Confirmed constraints** (honest limits, not bugs): read-only ⇒ only the displayed
  month is visible; the CAPTCHA fires from repeated refreshing and the only sanctioned
  mitigation is to refresh less; the account must stay a real single user's own booking.
- **Decisions taken** (see boundary): declined auto-navigating months / "Next available"
  (automated searching) and declined multi-centre auto-polling and CAPTCHA evasion.
- **Live accounts**: real accounts exist on the live backend for
  `abimbolaawarun@gmail.com` (usable) and `ayorindeawarun@gmail.com` (pre-existing,
  password unknown, no reset endpoint yet).

## Key commands
- Backend tests (43): `npm test` (repo root) — also `npm run lint`.
- Extension tests (51): `cd chrome-extension && npm test`.
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
1. **Alerts:** ✅ **Phone push is ON** — `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` set on
   Render's `availo-backend` service (verified 16 Jul: `/api/watch/push/key` serves the
   key). ⏳ **Email still pending:** set `RESEND_API_KEY`/`EMAIL_FROM` (needs a verified
   Resend domain). NOTE: Render env vars must be on the **service** (or a *linked* env
   group), not a standalone Environment Group.
2. Confirm auto-detection against **one real DVSA booking** — read-only "Check this
   page" only (never book as a test).
3. A short **closed beta** (3–5 real learners), watching for account safety.
4. **Publish:** Chrome Web Store + Firefox AMO (`docs/PUBLISHING.md`), iPhone App Store
   (`docs/IOS_BUILD.md`).

## Roadmap (designed, not built)
- **Multi-centre watching (2–3 nearby)** — per-tab, shared gentle refresh budget,
  priority-weighted. Design captured in `docs/MULTI_CENTRE.md`. Do it AFTER alerts.

## Recent efficiency pass (done, on `origin/main`)
Commit `9d583bb`: don't reload out from under a live slot offer; centre-name
normalization (`availoNormalizeCentre`, tolerates "Chorley (Euxton)"); debounced
MutationObserver; visibility-aware gentler cadence (hidden tab → ×1.5 refresh gap). All
in-bounds. Extension tests 54/54, backend 43/43, smoke 12/12.

## Pointers
- See it work: `docs/TRY_IT.md`
- Install & use: `docs/EXTENSION_INSTALL.md`
- Pre-launch test ladder: `docs/TESTING.md`
- Publish (Chrome/Firefox): `docs/PUBLISHING.md`
- iPhone build/submit: `docs/IOS_BUILD.md`
- Multi-centre design: `docs/MULTI_CENTRE.md`
- Architecture / deploy: `docs/ARCHITECTURE.md`, `DEPLOYMENT.md`, `render.yaml`

## Conventions
- The unrelated `Abims2026/` folder is a **different project** — gitignored, never part
  of Availo. Don't commit it here.
- Live URLs: frontend `https://availo-frontend-one.vercel.app`, backend
  `https://availo-backend-4dbx.onrender.com`. Repo: `github.com/ay4real5/availo`.
