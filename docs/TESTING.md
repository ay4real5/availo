# Availo — pre-production test plan

How to prove Availo works **before** publishing to the stores and before telling real
learners to rely on it. The rule that never bends: **we test everything *except*
actually booking on real DVSA** — the extension only ever reads, highlights, and
autofills; a human makes every booking. So this ladder ends with real users, but no
rung automates a real DVSA booking.

Work top to bottom. ✅ = a maintainer/dev can run it. 🔴 **YOU** = needs a real
browser / phone / booking, so it's a manual step.

---

## Layer 1 — Automated suites ✅
Proves the logic and the store packaging are sound.

```
cd chrome-extension && npm test          # 60 unit tests
cd ../backend       && npm test          # 43 unit tests
cd ../chrome-extension && npm run build:all
```
**Pass =** `pass 60` / `fail 0`, `pass 43` / `fail 0`, and three clean builds
(`chrome-build`, `firefox-build`, `safari-build`) with the localhost sanity check
green.

_Last run: 60/60, 43/43, all three builds clean._

## Layer 2 — Detection smoke in a real browser ✅
Proves the "spot an earlier slot / detect blocked / detect signed-out" engine works
against DVSA-shaped pages — no extension packing, no DVSA.

```
cd chrome-extension && python scripts/browser-smoke.py
```
**Pass =** `7/7 checks passed` (results + login recognised, slots found, earliest
picked, block + signed-out detected). Screenshots land in `_smoke-out/`.

_Last run: 7/7 passed._

## Layer 3 — Practice rehearsal on the safe fixture 🔴 YOU
Walk the real UX end-to-end against the built-in **fake** DVSA pages — DVSA is never
touched.

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → pick
   `chrome-extension/`.
2. Serve the fixture: `cd chrome-extension/dev-fixture && npx serve -l 5555 .`
   (or `python -m http.server 5555`).
3. Extension icon → **Practice run (safe rehearsal)** → walk sign-in → search →
   highlighted slot → **Book this test**.
4. Repeat on **Edge**, **Firefox desktop**, and **Firefox for Android**
   (`about:debugging` → load `firefox-build/`).

**Pass =** on each browser: the page is recognised, your details autofill, the
earlier slot is highlighted, and the Book button is *yours* to click (nothing
auto-submits).

## Layer 4 — Alerts, end-to-end 🔴 YOU
Confirms the away safety-net actually reaches a phone.

1. On **Render**, set `RESEND_API_KEY` + `EMAIL_FROM` (email) and
   `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (push — generate once with
   `npx web-push generate-vapid-keys`).
2. Add the web app to your phone's Home Screen (needed for iOS push, 16.4+).
3. Trigger a test alert and confirm the **email and phone push both arrive**.
4. Check **both** paths: an "earlier slot found" alert and a "you've been signed
   out" alert.

**Pass =** both alerts arrive on a real phone within a few seconds.

## Layer 5 — The one real-DVSA check (read-only) 🔴 YOU
The only thing the fixtures can't prove, because the real results page sits behind
your DVSA sign-in. **This reads the page only — it never books.**

1. A real learner signs in to the genuine DVSA "change your driving test" page.
2. Extension icon → **Check this page**.
3. **Pass =** it says something like *"✓ Availo can read this page — it can see N
   available dates."*
4. If it can't read a real page, tune the page-matching in
   `chrome-extension/selectors.js` + `chrome-extension/dvsa-heuristics.js` and repeat.

> Never go past "Check this page" into an actual booking as a test. If DVSA shows any
> challenge/error, the extension stops by design — leave it stopped.

## Layer 6 — Closed beta 🔴 YOU
3–5 real learners run it on **their own** real bookings for ~1 week. Track:
- detection misses / false "earlier" slots,
- alert latency,
- sign-out handling (does it tell them and resume?),
- **account safety above all** — no DVSA flags; keep auto-refresh **≥ 90s**.

**Gate:** only after a clean beta do you submit to the public stores.

## Layer 7 — Production gates before submitting 🔴 YOU
- Privacy policy live at `/privacy.html` with a **real** contact email (not the
  placeholder).
- Store listing copy + screenshots ready (see `PUBLISHING.md`).
- Version bump.
- Submit: `PUBLISHING.md` (Chrome/Firefox) and `IOS_BUILD.md` (iPhone).

---

## The boundary, restated
No test ever automates a real DVSA **booking, hold, payment, IP rotation, or
security-check bypass**. Layer 5 is a **read-only** "Check this page" and nothing
more. This is what keeps testers' accounts — and later, users' accounts — safe.
