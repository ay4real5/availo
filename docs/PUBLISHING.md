# Publishing the Availo extension (Chrome Web Store + Firefox AMO)

Everything you need to get the extension into the two stores so ordinary users can
install it with one click. Steps marked **🔴 YOU** need a human (accounts,
screenshots, the actual upload/review); everything else is already done in the repo.

---

## 0. One-time prerequisites — 🔴 YOU
- **Chrome Web Store developer account** — one-time **$5** fee: https://chrome.google.com/webstore/devconsole
- **Firefox add-on developer account** — free: https://addons.mozilla.org/developers/
- **A contact email + (ideally) a domain.** The privacy policy currently uses
  `privacy@availo.app` as a placeholder — change it in `frontend/public/privacy.html`
  to an address you actually monitor before you submit.
- **Screenshots** (see the shot-list below) — needs a real browser; I can't take them.

---

## 1. Build the packages
From `chrome-extension/`:
```
npm run build:all
```
This produces two clean, store-ready folders (no localhost, no dev/test files, no
legacy tracking script, prod backend baked in):
- `chrome-build/`  → for the Chrome Web Store
- `firefox-build/` → for Firefox AMO / Android

**Zip the *contents* of each folder** (not the folder itself) into `availo-chrome.zip`
and `availo-firefox.zip`. That's what you upload.

---

## 2. Privacy policy URL
Already written and deploys with the frontend to:
```
https://availo-frontend-one.vercel.app/privacy.html
```
Both stores require this URL. (Confirm it loads after the frontend deploys, and that
you've updated the contact email in it.)

---

## 3. Ready-to-paste listing copy (both stores)

**Name:** `Availo: Earlier Driving Test Finder`

**Summary / short description (≤132 chars):**
`Get alerted the instant an earlier DVSA driving-test cancellation appears — and fill your details so you're one tap from booking.`

**Category:** Productivity

**Detailed description:**
```
Waiting months for a driving test? Availo watches the DVSA "change your driving
test" page for you and alerts you the moment an earlier cancellation appears — so
you can grab it before it's gone, without sitting there refreshing all day.

How it works:
1. Open the real DVSA "change your driving test" page and sign in as normal.
2. Availo watches that page and alerts you (on screen, and by email/phone if you
   set it up) the instant an earlier slot appears.
3. It highlights the slot and fills your details, so you're one tap from booking.

You are always in control:
• Availo never books, holds, or pays for a test on its own — you make the booking.
• Your licence number and booking reference stay on YOUR device, never on our
  servers.
• It only runs on the DVSA gov.uk pages, and it never tries to bypass DVSA's
  security — if it sees a check, it stops.

Availo is an independent tool and is not affiliated with DVSA or GOV.UK.
```

**Single-purpose statement (Chrome asks for this):**
```
Availo watches the DVSA "change your driving test" page the user has open and
alerts them when an earlier slot appears, then fills the user's own details so they
can book it faster. It does not book or reserve anything itself.
```

**Permission justifications (paste per permission):**
| Permission | Justification |
|---|---|
| `host_permissions: https://*.gov.uk/*` | Read the DVSA change-test results page the user is viewing (to spot earlier slots) and fill the login/search forms with the user's saved details. Runs only on gov.uk. |
| `storage` | Save the user's settings and their licence/booking reference locally on their own device. |
| `notifications` | Show a desktop alert when an earlier slot appears or the user is signed out. |
| `alarms` | Periodically re-check the page while watching, reliably in the background. |
| `tabs` | Identify which tab is being watched so alerts point to the right place. |
| `activeTab` | Act on the DVSA tab the user is currently using when they click the extension. |

**Data-use disclosures (Chrome "Privacy practices" form):**
- Personally identifiable info: **Yes** — name/email (for the account). *Not sold.*
- Authentication info: **Yes** — email/password (account sign-in). *Not sold.*
- Website content / location / financial / health: **No.**
- Note in the justification box: *"Driving licence number and booking reference are
  stored only in the user's browser and are never transmitted to our servers."*
- Uses: **App functionality only.** Not sold to third parties. Not used for ads.

---

## 4. Chrome Web Store — submit — 🔴 YOU
1. Dev console → **New item** → upload `availo-chrome.zip`.
2. Fill the listing with the copy above; add screenshots (≥1, 1280×800 or 640×400).
3. Add the **privacy policy URL** and complete the **Privacy practices** form.
4. Submit for review (usually a few days; the broad-ish gov.uk host permission may
   draw a closer look — the justifications above are written for that).

## 5. Firefox AMO — submit — 🔴 YOU
1. https://addons.mozilla.org/developers/ → **Submit a New Add-on** → upload
   `availo-firefox.zip`.
2. Choose "On this site" (listed). Add the same listing copy + privacy URL.
3. Our code isn't minified, so no separate source upload is needed; if asked, point
   to this repo.
4. Submit. Once approved it's installable on **Firefox for Android** too (that's the
   no-laptop path — see `docs/EXTENSION_INSTALL.md`).

---

## 6. Screenshot shot-list (🔴 YOU, in a real browser)
Capture these (use the practice fixture or a real DVSA page):
1. The extension popup on a DVSA page — "Start watching this tab".
2. The in-page "earlier slot found" banner with a highlighted slot.
3. The "Check this page" diagnostic showing "✓ Availo can read this page".
4. The settings page (vault + auto-refresh), showing "stored on this device only".
5. (Optional) a phone/desktop notification.

---

## 7. Before real users rely on alerts — 🔴 YOU
Phone/email push only actually sends once these are set on the **Render** backend:
- `RESEND_API_KEY` + `EMAIL_FROM` (email alerts).
- `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (phone push) — generate once with
  `npx web-push generate-vapid-keys`.
And the standing item: confirm auto-detection against a **real DVSA booking** using
the "Check this page" button before telling users it's live.
